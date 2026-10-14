// -----------------------------------------------------------------------------
// The integration itself: the account read, discovery, the paced refresh
// loop, the commands (zone switches, standby), the scene triggers and
// actions, the "garden" widget, the Gladys Plus webhooks and the test button.
// index.js only wires the SDK handlers to it.
//
// Pace (see CLAUDE.md for the daily budget): the account (person/{id}) every
// `poll_interval` minutes, with the running schedule of each online
// controller; while a controller waters, or is expected to after a command,
// its running schedule every 2 minutes. A loop tick every minute decides;
// most ticks make no call. Below 100 calls left the loop slows down, at 0 it
// pauses until Rachio resets the budget.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  COMMAND_SETTLE,
  EXPECT_WINDOW,
  LOW_BUDGET,
  LOW_BUDGET_INTERVAL,
  MAX_RAIN_DELAY_HOURS,
  MAX_ZONE_SECONDS,
  RATE_LIMIT_PAUSE,
  TICK_INTERVAL,
  WATCH_INTERVAL,
  WEBHOOKS,
  WEBHOOK_COOLDOWN,
  WIDGETS,
  WIDGET_ACTIONS,
} from './constants.js';
import {
  DEVICE_TYPES,
  FEATURE,
  controllerStates,
  discoveredDevices,
  ids,
  parseExternalId,
  zoneStates,
} from './devices.js';
import { T } from './i18n.js';
import { RachioClient, RachioError } from './rachio/client.js';
import {
  controllersOf,
  findSchedule,
  fold,
  personIdOf,
  readingOf,
  runOf,
  webhookEventTypesOf,
  webhooksOf,
} from './rachio/model.js';
import { controllerEvents } from './triggers.js';
import { eventTypeIds, inboundEvent, planWebhooks, webhookExternalId } from './webhook.js';
import { gardenWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

export class RachioApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'rachio' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (options) => new RachioClient(options),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = clientFactory({ apiKey: '' });
    this.generation = 0;
    this.tickTimer = undefined;
    this.ticking = undefined;
    this.lastStatus = undefined;
    this.reset();
  }

  reset({ keepPerson = false } = {}) {
    if (!keepPerson) {
      this.personId = undefined;
    }
    /** Rachio device id -> controller (model) */
    this.controllers = new Map();
    /** The last account read attempt: a failing read is retried at the same pace. */
    this.personAt = 0;
    /** Rachio device id -> { run, at }: the last running schedule read */
    this.runs = new Map();
    /** Rachio device id -> instant of a start command whose run is not seen yet */
    this.expected = new Map();
    /** Rachio device id -> the last reading (the triggers compare with it) */
    this.readings = new Map();
    /** Rachio device id -> { timer, what }: the read back after a command */
    this.settleTimers = new Map();
    this.pausedUntil = 0;
    this.webhook = { url: undefined, externalId: undefined, active: false };
    this.webhookPending = true;
    this.webhookAt = 0;
    this.webhookTimer = undefined;
    this.webhookQueue = new Set();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    const previousKey = this.config.apiKey;
    this.config = normalizeConfig(raw);
    this.client = this.clientFactory({ apiKey: this.config.apiKey });
    // Same key, same person: one call saved on every reconnection.
    this.reset({ keepPerson: Boolean(previousKey) && previousKey === this.config.apiKey });
    if (!this.config.apiKey) {
      await this.setStatus(false, T.noKey);
      return;
    }
    try {
      await this.readAccount();
      await this.publishDevices();
      await this.readRuns(true);
      await this.publish();
      await this.syncWebhooks();
      await this.reportOk();
    } catch (err) {
      await this.reportError(err);
      if (err instanceof RachioError && err.code === 'unauthorized') {
        return;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.tickTimer = this.timers.setInterval(
      () => this.tick().catch((err) => this.reportError(err)),
      TICK_INTERVAL,
    );
  }

  stop() {
    this.generation += 1;
    this.timers.clearInterval(this.tickTimer);
    this.tickTimer = undefined;
    for (const { timer } of this.settleTimers.values()) {
      this.timers.clearTimeout(timer);
    }
    this.settleTimers.clear();
    this.timers.clearTimeout(this.webhookTimer);
    this.webhookTimer = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportOk() {
    if (this.lowBudget()) {
      await this.setStatus(true, T.lowBudget(this.client.rateLimit?.resetAt));
      return;
    }
    if (this.controllers.size === 0) {
      await this.setStatus(true, T.noController);
      return;
    }
    const controllers = [...this.controllers.values()];
    await this.setStatus(
      true,
      T.ok({
        controllers: controllers.length,
        zones: controllers.reduce((n, c) => n + c.zones.filter((z) => z.enabled).length, 0),
        realtime: this.webhook.active,
      }),
    );
  }

  async reportError(err) {
    this.logger.warn(`Rachio: ${err.message}`);
    const code = err instanceof RachioError ? err.code : undefined;
    if (code === 'unauthorized') {
      // A refused key stays refused: no point in spending calls until it changes.
      this.timers.clearInterval(this.tickTimer);
      this.tickTimer = undefined;
      await this.setStatus(false, T.unauthorized);
    } else if (code === 'rate_limited') {
      await this.pause();
    } else if (code === 'no_key') {
      await this.setStatus(false, T.noKey);
    } else {
      await this.setStatus(false, T.unreachable(err.message));
    }
  }

  // --- Budget ----------------------------------------------------------------------

  /** Fewer than LOW_BUDGET calls left before Rachio's daily reset. */
  lowBudget() {
    const rateLimit = this.client?.rateLimit;
    if (rateLimit?.remaining === null || rateLimit?.remaining === undefined) {
      return false;
    }
    if (rateLimit.resetAt && Date.parse(rateLimit.resetAt) <= this.now()) {
      return false;
    }
    return rateLimit.remaining < LOW_BUDGET;
  }

  /** The budget is spent: no call until the reset Rachio announced. */
  async pause() {
    const resetAt = this.client.rateLimit?.resetAt;
    const reset = resetAt ? Date.parse(resetAt) : NaN;
    this.pausedUntil = reset > this.now() ? reset : this.now() + RATE_LIMIT_PAUSE;
    await this.setStatus(false, T.rateLimited(reset > this.now() ? resetAt : null));
  }

  // --- Reading -----------------------------------------------------------------------

  async readAccount() {
    this.personAt = this.now();
    if (!this.personId) {
      this.personId = personIdOf(await this.client.personInfo());
      if (!this.personId) {
        throw new RachioError('http', 'person/info answered without a person id');
      }
    }
    const controllers = controllersOf(await this.client.person(this.personId));
    this.controllers = new Map(controllers.map((c) => [c.id, c]));
  }

  async readRun(controllerId) {
    const previous = this.runs.get(controllerId);
    // The attempt counts: a failing read is retried at the same pace, not every tick.
    this.runs.set(controllerId, { run: previous?.run ?? null, at: this.now() });
    const run = runOf(await this.client.currentSchedule(controllerId));
    this.runs.set(controllerId, { run, at: this.now() });
    // A run seen keeps the watch going by itself; none after the window: give up.
    const since = this.expected.get(controllerId);
    if (since !== undefined && (run || this.now() - since >= EXPECT_WINDOW)) {
      this.expected.delete(controllerId);
    }
  }

  /**
   * The running schedules due: every 2 minutes for a controller that waters
   * or is expected to (a start command, for EXPECT_WINDOW), otherwise only
   * with the account read (`base`).
   */
  async readRuns(base) {
    if (this.lowBudget()) {
      return;
    }
    const now = this.now();
    for (const controller of [...this.controllers.values()]) {
      if (!controller.online) {
        continue;
      }
      const entry = this.runs.get(controller.id);
      const watching = Boolean(entry?.run) || this.expected.has(controller.id);
      // Half a tick of slack: the timers are not exact.
      const due = watching ? !entry || now - entry.at >= WATCH_INTERVAL - TICK_INTERVAL / 2 : base;
      if (due) {
        await this.readRun(controller.id);
      }
    }
  }

  tick() {
    if (!this.ticking) {
      this.ticking = this.doTick().finally(() => {
        this.ticking = undefined;
      });
    }
    return this.ticking;
  }

  async doTick() {
    const generation = this.generation;
    const now = this.now();
    if (now < this.pausedUntil) {
      return;
    }
    const calls = this.client.calls;
    const interval = this.lowBudget() ? LOW_BUDGET_INTERVAL : this.config.pollMinutes * 60_000;
    const accountDue = now - this.personAt >= interval;
    if (accountDue) {
      await this.readAccount();
    }
    await this.readRuns(accountDue);
    if (generation !== this.generation) {
      return;
    }
    await this.publish();
    if (this.webhookPending && this.controllers.size > 0) {
      await this.syncWebhooks();
    }
    if (this.client.rateLimit?.remaining === 0) {
      await this.pause();
    } else if (this.client.calls > calls) {
      // Only a tick that reached Rachio may say so (a quiet tick keeps the status).
      await this.reportOk();
    }
  }

  /** States of the created devices, scene events, widget nudge. No API call. */
  async publish() {
    const now = this.now();
    const created = new Set((this.gladys.devices ?? []).map((d) => d.external_id));
    const states = [];
    const events = [];
    for (const controller of this.controllers.values()) {
      const reading = readingOf(controller, this.runs.get(controller.id)?.run ?? null, now);
      const previous = this.readings.get(controller.id);
      this.readings.set(controller.id, reading);
      const controllerId = ids.controller(this.gladys, controller.id);
      if (created.has(controllerId)) {
        states.push(...controllerStates(controllerId, reading));
      }
      for (const zone of controller.zones) {
        const zoneId = ids.zone(this.gladys, zone.id);
        if (created.has(zoneId)) {
          states.push(...zoneStates(zoneId, controller, zone, reading));
        }
      }
      const target = {
        controller: controllerId,
        name: controller.name,
        zone: (id) => ids.zone(this.gladys, id),
      };
      events.push(...controllerEvents(target, previous, reading, now));
    }
    let changed = 0;
    if (states.length > 0) {
      try {
        const result = await this.gladys.publishChangedStates(states, { heartbeat: 60 * 60_000 });
        changed = result?.count ?? 0;
      } catch (err) {
        this.logger.warn(`States failed: ${err.message}`);
      }
    }
    for (const event of events) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
    }
    if (changed > 0 || events.length > 0) {
      this.gladys.requestWidgetRefresh(WIDGETS.GARDEN);
    }
  }

  // --- Discovery -------------------------------------------------------------------

  async publishDevices() {
    await this.gladys.publishDiscoveredDevices(
      discoveredDevices(this.gladys, [...this.controllers.values()]),
    );
  }

  /** The user asked for a scan: read the account again (new zones, names). */
  async scan() {
    await this.readAccount();
    await this.publishDevices();
    await this.publish();
  }

  /** A device was created: the SDK forgot its states, publish them now. */
  async deviceCreated() {
    await this.publish();
  }

  // --- Lookups ---------------------------------------------------------------------------

  async ensureAccount() {
    if (this.controllers.size === 0) {
      await this.readAccount();
    }
  }

  /** A controller from a controller or zone device, a Rachio id or a name. */
  controllerFor(value) {
    const parsed = parseExternalId(value);
    if (parsed?.kind === DEVICE_TYPES.ZONE) {
      return this.zoneFor(value).controller;
    }
    const id = parsed?.kind === DEVICE_TYPES.CONTROLLER ? parsed.id : String(value ?? '').trim();
    const controller =
      this.controllers.get(id) ??
      [...this.controllers.values()].find((c) => id && fold(c.name) === fold(id));
    if (!controller) {
      throw new Error(T.unknownController(value ?? '').en);
    }
    return controller;
  }

  /** { controller, zone } from a zone device, a Rachio zone id or a zone name. */
  zoneFor(value) {
    const parsed = parseExternalId(value);
    const id = parsed?.kind === DEVICE_TYPES.ZONE ? parsed.id : String(value ?? '').trim();
    for (const controller of this.controllers.values()) {
      const zone = controller.zones.find((z) => z.id === id);
      if (zone) {
        return { controller, zone };
      }
    }
    if (!parsed && id) {
      for (const controller of this.controllers.values()) {
        const zone = controller.zones.find((z) => fold(z.name) === fold(id));
        if (zone) {
          return { controller, zone };
        }
      }
    }
    throw new Error(T.unknownZone(value ?? '').en);
  }

  /** The controllers a scene action targets: the one chosen, or every online one. */
  targets(value) {
    if (value) {
      return [this.controllerFor(value)];
    }
    return [...this.controllers.values()].filter((c) => c.online);
  }

  minutesOf(value) {
    const n = Number(value);
    return value !== '' && value !== null && Number.isFinite(n) && n > 0
      ? Math.min(MAX_ZONE_SECONDS / 60, n)
      : this.config.defaultMinutes;
  }

  /** A zone run in seconds: at least a minute, at most what Rachio accepts. */
  secondsFor(zone, minutes) {
    const max = Math.min(MAX_ZONE_SECONDS, zone.maxSeconds || MAX_ZONE_SECONDS);
    return Math.max(60, Math.min(max, Math.round(minutes * 60)));
  }

  // --- Commands ------------------------------------------------------------------------

  /**
   * A command changed the watering of a controller: read it back once the
   * command reached it, and after a start, watch it every 2 minutes until
   * the run shows up (EXPECT_WINDOW at most).
   */
  expect(controllerId, { start = true } = {}) {
    if (start) {
      this.expected.set(controllerId, this.now());
    } else {
      this.expected.delete(controllerId);
    }
    this.settle(controllerId, { run: true });
  }

  /** Read a controller back COMMAND_SETTLE after a command (one timer each). */
  settle(controllerId, what) {
    const pending = this.settleTimers.get(controllerId);
    const merged = {
      account: Boolean(what.account || pending?.what.account),
      run: Boolean(what.run || pending?.what.run),
    };
    if (pending) {
      this.timers.clearTimeout(pending.timer);
    }
    const timer = this.timers.setTimeout(() => {
      this.settleTimers.delete(controllerId);
      return this.readBack(controllerId, merged).catch((err) =>
        this.logger.warn(`Read back failed: ${err.message}`),
      );
    }, COMMAND_SETTLE);
    this.settleTimers.set(controllerId, { timer, what: merged });
  }

  async readBack(controllerId, { account, run }) {
    const generation = this.generation;
    if (account) {
      await this.readAccount();
    }
    if (run && this.controllers.get(controllerId)?.online) {
      await this.readRun(controllerId);
    }
    if (generation === this.generation) {
      await this.publish();
    }
  }

  async startZoneRun(controller, zone, minutes) {
    const seconds = this.secondsFor(zone, minutes);
    await this.client.startZone(zone.id, seconds);
    this.logger.info(`Watering ${zone.name} for ${seconds} s`);
    this.expect(controller.id);
    return seconds;
  }

  async stopController(controller) {
    await this.client.stopWater(controller.id);
    this.logger.info(`Watering stopped on ${controller.name}`);
    this.expect(controller.id, { start: false });
  }

  async startScheduleRun(controller, schedule) {
    await this.client.startSchedule(schedule.id);
    this.logger.info(`Schedule ${schedule.name} started on ${controller.name}`);
    this.expect(controller.id);
  }

  async rainDelayFor(controller, hours) {
    await this.client.rainDelay(controller.id, hours * 3600);
    this.logger.info(`Rain delay of ${hours} h on ${controller.name}`);
    this.settle(controller.id, { account: true });
  }

  /** Gladys command: a zone switch (start / stop) or a controller's standby switch. */
  async setValue(device, feature, value) {
    const key = String(feature.external_id).split(':').at(-1);
    const target = parseExternalId(device.external_id);
    const on = Number(value) === 1;
    await this.ensureAccount();
    if (target?.kind === DEVICE_TYPES.ZONE && key === FEATURE.WATERING) {
      const { controller, zone } = this.zoneFor(device.external_id);
      if (on) {
        await this.startZoneRun(controller, zone, this.config.defaultMinutes);
      } else {
        await this.stopController(controller);
      }
    } else if (target?.kind === DEVICE_TYPES.CONTROLLER && key === FEATURE.ON) {
      const controller = this.controllerFor(device.external_id);
      await this.client.setOn(controller.id, on);
      controller.on = on;
      this.settle(controller.id, { account: true });
    } else {
      throw new Error(`${feature.external_id} is not a command`);
    }
    await this.gladys.publishState(feature.external_id, on ? 1 : 0).catch(() => {});
    // Published outside publishChangedStates: let the read back re-send the
    // value if the command did not take.
    this.gladys.forgetPublishedStates(feature.external_id);
  }

  // --- Scene actions ---------------------------------------------------------------

  async waterZone(fields = {}) {
    await this.ensureAccount();
    const { controller, zone } = this.zoneFor(fields.zone);
    const seconds = await this.startZoneRun(controller, zone, this.minutesOf(fields.minutes));
    return {
      zone_name: zone.name,
      controller_name: controller.name,
      minutes: Math.round(seconds / 60),
    };
  }

  async waterZones(fields = {}) {
    await this.ensureAccount();
    const values = Array.isArray(fields.zones)
      ? fields.zones
      : String(fields.zones ?? '').split(',');
    const wanted = values.map((v) => String(v).trim()).filter(Boolean);
    if (wanted.length === 0) {
      throw new Error('Pick at least one Rachio zone');
    }
    const minutes = this.minutesOf(fields.minutes);
    // start_multiple runs on one controller: one call per controller.
    const groups = new Map();
    for (const value of wanted) {
      const { controller, zone } = this.zoneFor(value);
      const group = groups.get(controller.id) ?? { controller, zones: new Map() };
      group.zones.set(zone.id, zone);
      groups.set(controller.id, group);
    }
    let count = 0;
    let total = 0;
    for (const { controller, zones } of groups.values()) {
      const list = [...zones.values()]
        .sort((a, b) => (a.number ?? 999) - (b.number ?? 999))
        .map((z) => ({ id: z.id, seconds: this.secondsFor(z, minutes) }));
      await this.client.startZones(list);
      const seconds = list.reduce((sum, z) => sum + z.seconds, 0);
      this.logger.info(`Watering ${list.length} zones on ${controller.name} (${seconds} s)`);
      this.expect(controller.id);
      count += list.length;
      total += seconds;
    }
    return { count, total_minutes: Math.round(total / 60) };
  }

  scheduleFor(fields) {
    const pool = fields.controller
      ? [this.controllerFor(fields.controller)]
      : [...this.controllers.values()];
    const found = findSchedule(pool, fields.schedule);
    if (!found) {
      throw new Error(T.unknownSchedule(fields.schedule ?? '').en);
    }
    return found;
  }

  async runSchedule(fields = {}) {
    await this.ensureAccount();
    const { controller, schedule } = this.scheduleFor(fields);
    await this.startScheduleRun(controller, schedule);
    return {
      schedule_name: schedule.name,
      controller_name: controller.name,
      minutes: Math.round((schedule.totalSeconds ?? 0) / 60),
    };
  }

  async skipSchedule(fields = {}) {
    await this.ensureAccount();
    const { controller, schedule } = this.scheduleFor(fields);
    await this.client.skipSchedule(schedule.id);
    this.logger.info(`Schedule ${schedule.name} skipped on ${controller.name}`);
    return { schedule_name: schedule.name, controller_name: controller.name };
  }

  async stopWatering(fields = {}) {
    await this.ensureAccount();
    const list = this.targets(fields.controller);
    for (const controller of list) {
      await this.stopController(controller);
    }
    return { stopped: list.length };
  }

  async setRainDelay(fields = {}) {
    await this.ensureAccount();
    const n = Number(fields.hours);
    if (fields.hours === '' || fields.hours === null || !Number.isFinite(n)) {
      throw new Error('The number of hours is required (0 cancels the rain delay)');
    }
    const hours = Math.max(0, Math.min(MAX_RAIN_DELAY_HOURS, Math.round(n)));
    const list = this.targets(fields.controller);
    for (const controller of list) {
      await this.rainDelayFor(controller, hours);
    }
    return {
      hours,
      until: hours > 0 ? new Date(this.now() + hours * 3_600_000).toISOString() : null,
      controllers: list.length,
    };
  }

  // --- Widget ----------------------------------------------------------------------

  async getWidget({ settings = {}, language } = {}) {
    let controller;
    try {
      controller = settings.controller
        ? this.controllerFor(settings.controller)
        : [...this.controllers.values()][0];
    } catch {
      controller = undefined;
    }
    const reading = controller
      ? readingOf(controller, this.runs.get(controller.id)?.run ?? null, this.now())
      : undefined;
    return gardenWidget({
      controller,
      reading,
      defaultMinutes: this.config.defaultMinutes,
      language: language ?? 'en',
    });
  }

  async widgetAction(actionKey, params = {}, { values } = {}) {
    try {
      await this.ensureAccount();
      const controller = this.controllerFor(params.controller);
      if (actionKey === WIDGET_ACTIONS.STOP) {
        await this.stopController(controller);
        return T.widget.stopped;
      }
      // The other buttons open a form: an older core sends no values.
      if (!values) {
        return T.widget.needsForm;
      }
      if (actionKey === WIDGET_ACTIONS.START) {
        const { zone } = this.zoneFor(values.zone);
        const seconds = await this.startZoneRun(controller, zone, this.minutesOf(values.minutes));
        return T.widget.started(zone.name, Math.round(seconds / 60));
      }
      if (actionKey === WIDGET_ACTIONS.SCHEDULE) {
        const found = findSchedule([controller], values.schedule);
        if (!found) {
          return T.unknownSchedule(values.schedule ?? '');
        }
        await this.startScheduleRun(controller, found.schedule);
        return T.widget.scheduleStarted(found.schedule.name);
      }
      if (actionKey === WIDGET_ACTIONS.RAIN_DELAY) {
        const hours = Math.max(
          0,
          Math.min(MAX_RAIN_DELAY_HOURS, Math.round(Number(values.hours) || 0)),
        );
        await this.rainDelayFor(controller, hours);
        return T.widget.rainDelaySet(hours);
      }
      throw new Error(`unknown action ${actionKey}`);
    } catch (err) {
      return T.widget.failed(err.message);
    }
  }

  // --- Gladys Plus webhooks ------------------------------------------------------------

  /**
   * Register (or remove) the Rachio webhook of every controller. Best effort:
   * a failure leaves the integration on polling, which stays the source of
   * truth. `info` comes from onWebhookUpdated; without it, it is read.
   */
  async syncWebhooks(info) {
    this.webhookPending = false;
    let state = info;
    if (!state) {
      try {
        state = await this.gladys.getWebhooks();
      } catch (err) {
        this.logger.warn(`Webhook state unavailable: ${err.message}`);
        state = { available: false, webhooks: [] };
      }
    }
    const url = state?.available
      ? state.webhooks?.find((w) => w.key === WEBHOOKS.EVENTS)?.url
      : undefined;
    // Gladys Plus unlinked after a registration: remove ours at Rachio.
    const cleanup = Boolean(info) && !url && Boolean(this.webhook.url);
    this.webhook = { url, externalId: url ? webhookExternalId(url) : undefined, active: false };
    if ((!url && !cleanup) || this.controllers.size === 0 || this.lowBudget()) {
      return;
    }
    try {
      const typeIds = url
        ? eventTypeIds(webhookEventTypesOf(await this.client.webhookEventTypes()))
        : [];
      if (url && typeIds.length === 0) {
        throw new Error('Rachio offers no webhook event type');
      }
      const target = url ? { url, externalId: this.webhook.externalId } : undefined;
      for (const controller of this.controllers.values()) {
        const existing = webhooksOf(await this.client.deviceWebhooks(controller.id));
        const plan = planWebhooks(existing, target);
        for (const id of plan.remove) {
          await this.client.deleteWebhook(id);
        }
        if (plan.add) {
          await this.client.addWebhook({
            deviceId: controller.id,
            externalId: target.externalId,
            url,
            eventTypeIds: typeIds,
          });
        }
      }
      this.webhook.active = Boolean(url);
      this.logger.info(url ? 'Rachio webhooks registered' : 'Rachio webhooks removed');
    } catch (err) {
      this.logger.warn(`Rachio webhooks: ${err.message} (polling only)`);
    }
  }

  async webhookUpdated(info) {
    await this.syncWebhooks(info);
    if (this.controllers.size > 0) {
      await this.reportOk();
    }
  }

  /** A Rachio event relayed by Gladys Plus: refresh that controller (trigger, not data). */
  async handleWebhook(request) {
    const event = inboundEvent(request, {
      externalId: this.webhook.externalId,
      controllerIds: [...this.controllers.keys()],
    });
    if (!event.ok) {
      this.logger.debug?.(`Webhook ignored: ${event.reason}`);
      return;
    }
    this.logger.debug?.(`Rachio event ${event.type ?? '?'}/${event.subType ?? '?'}`);
    try {
      await this.eventRefresh(event.deviceId);
    } catch (err) {
      await this.reportError(err);
    }
  }

  /** At most one refresh per WEBHOOK_COOLDOWN; a burst ends with one trailing refresh. */
  async eventRefresh(controllerId) {
    const now = this.now();
    if (now < this.pausedUntil || this.lowBudget()) {
      return; // the poll catches up
    }
    const wait = this.webhookAt + WEBHOOK_COOLDOWN - now;
    if (wait > 0) {
      this.webhookQueue.add(controllerId);
      if (!this.webhookTimer) {
        this.webhookTimer = this.timers.setTimeout(() => {
          this.webhookTimer = undefined;
          const queued = [...this.webhookQueue];
          this.webhookQueue.clear();
          return this.eventRefreshNow(queued).catch((err) => this.reportError(err));
        }, wait);
      }
      return;
    }
    await this.eventRefreshNow([controllerId]);
  }

  async eventRefreshNow(controllerIds) {
    const generation = this.generation;
    this.webhookAt = this.now();
    await this.readAccount();
    for (const id of controllerIds) {
      if (this.controllers.get(id)?.online) {
        await this.readRun(id);
      }
    }
    if (generation === this.generation) {
      await this.publish();
    }
  }

  // --- Configuration screen button --------------------------------------------------

  async testConnection() {
    if (!this.config.apiKey) {
      return T.noKey;
    }
    try {
      await this.readAccount();
      return T.test({
        controllers: [...this.controllers.values()],
        rateLimit: this.client.rateLimit,
        realtime: this.webhook.active,
      });
    } catch (err) {
      const code = err instanceof RachioError ? err.code : undefined;
      if (code === 'unauthorized') {
        return T.unauthorized;
      }
      if (code === 'rate_limited') {
        return T.rateLimited(this.client.rateLimit?.resetAt);
      }
      return T.unreachable(err.message);
    }
  }
}
