// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Rachio API.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { RachioApp } from '../src/app.js';
import {
  ACTIONS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WEBHOOKS,
  WIDGETS,
  WIDGET_ACTIONS,
} from '../src/constants.js';
import { webhookExternalId } from '../src/webhook.js';
import {
  BACK,
  BEDS,
  FIXTURE_NOW,
  FLEX_SCHEDULE,
  FRONT,
  HEDGE,
  LAWN,
  LAWN_SCHEDULE,
  ORCHARD,
  VEG,
  PASS,
  fixture,
  installFetch,
  json,
  running,
} from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};

let fake;
afterEach(() => fake?.restore());

const MINUTE = 60_000;
const CONTROLLER = `ext:rachio:controller:${FRONT}`;
const zoneDevice = (id) => `ext:rachio:zone:${id}`;
const RELAY = 'https://plus.example.invalid/webhooks/rachio/events';
const CONFIG = { api_key: 'k3y-1234', default_minutes: 10, poll_interval: 10 };

async function setup({ config = CONFIG, webhooks, budget, routes = [], create = true } = {}) {
  const state = {
    person: fixture('person.json'),
    runs: {},
    webhooks: { [FRONT]: [], [BACK]: [] },
  };
  fake = installFetch(
    [
      ...routes,
      ['GET', /^person\/info$/, () => fixture('person-info.json')],
      ['GET', /^person\/[^/]+$/, () => state.person],
      [
        'GET',
        /^device\/[^/]+\/current_schedule$/,
        ({ path }) => state.runs[path.split('/')[1]] ?? {},
      ],
      ['PUT', /^(zone|device|schedulerule)\/[a-z_]+$/, () => undefined],
      ['GET', /^notification\/webhook_event_type$/, () => fixture('webhook-event-types.json')],
      ['GET', /^notification\/[^/]+\/webhook$/, ({ path }) => state.webhooks[path.split('/')[1]]],
      ['POST', /^notification\/webhook$/, ({ body }) => ({ id: 'new-hook', ...body })],
      ['DELETE', /^notification\/webhook\/.+$/, () => undefined],
    ],
    { budget },
  );
  const gladys = createFakeGladys({ selector: 'rachio', config, webhooks });
  const timers = createFakeTimers();
  const clock = { now: FIXTURE_NOW };
  const app = new RachioApp({ gladys, logger: quiet, now: () => clock.now, timers });
  // The wiring of index.js.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.deviceCreated());
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));
  gladys.onSceneAction(SCENE_ACTIONS.WATER_ZONE, (f) => app.waterZone(f));
  gladys.onSceneAction(SCENE_ACTIONS.WATER_ZONES, (f) => app.waterZones(f));
  gladys.onSceneAction(SCENE_ACTIONS.RUN_SCHEDULE, (f) => app.runSchedule(f));
  gladys.onSceneAction(SCENE_ACTIONS.SKIP_SCHEDULE, (f) => app.skipSchedule(f));
  gladys.onSceneAction(SCENE_ACTIONS.STOP, (f) => app.stopWatering(f));
  gladys.onSceneAction(SCENE_ACTIONS.RAIN_DELAY, (f) => app.setRainDelay(f));
  gladys.onWidgetGet(WIDGETS.GARDEN, (request) => app.getWidget(request));
  gladys.onWidgetAction(WIDGETS.GARDEN, (key, params, context) =>
    app.widgetAction(key, params, context),
  );
  gladys.onWebhook(WEBHOOKS.EVENTS, (request) => app.handleWebhook(request));
  gladys.onWebhookUpdated((info) => app.webhookUpdated(info));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  await gladys.connect();
  await app.start(config);
  if (create) {
    for (const device of gladys.fake.discoveredDevices ?? []) {
      await gladys.fake.deviceCreated(device);
    }
  }
  return { app, gladys, timers, clock, state };
}

/** The calls made, as "METHOD path" lines. */
const made = (from = 0) => fake.calls.slice(from).map((c) => `${c.method} ${c.path}`);
const device = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
const featureOf = (d, key) => d.features.find((f) => f.external_id.endsWith(`:${key}`));

/** Move the clock minute by minute, running the loop at each tick. */
async function advance({ clock, timers }, minutes, each = async () => {}) {
  for (let i = 0; i < minutes; i += 1) {
    clock.now += MINUTE;
    await each(clock.now);
    await timers.runIntervals();
  }
}

test('without an API key: the status asks for one and nothing is read', async () => {
  const { gladys, timers } = await setup({ config: {}, create: false });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /paste your Rachio API key/);
  assert.equal(fake.calls.length, 0);
  assert.equal(timers.intervals().length, 0);
});

test('start: the account is read, the devices offered, their states published once created', async () => {
  const { gladys, timers } = await setup();
  assert.deepEqual(made(), [
    'GET person/info',
    'GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f',
    `GET device/${FRONT}/current_schedule`,
  ]);
  // The offline controller is not asked for its schedule.
  assert.equal(fake.calls[0].headers.Authorization, 'Bearer k3y-1234');
  assert.equal(gladys.fake.discoveredDevices.length, 7);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Connected to Rachio: 2 controllers, 5 zones.',
      fr: 'Connecté à Rachio : 2 contrôleurs, 5 zones.',
    },
  });
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:online`), 1);
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:watering`), 0);
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:current_zone`), '—');
  assert.equal(gladys.fake.lastState(`ext:rachio:controller:${BACK}:on`), 0, 'standby');
  assert.equal(
    gladys.fake.lastState(`${zoneDevice(LAWN)}:last_watered`),
    '2026-10-12 06:00 · 15 min',
  );
  assert.equal(gladys.fake.lastState(`${zoneDevice(ORCHARD)}:watering`), 0);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first reading');
  assert.equal(timers.intervals()[0].ms, MINUTE);
  // A scan reads the account again (new zones, renamed ones).
  const before = fake.calls.length;
  await gladys.fake.scanRequest();
  assert.deepEqual(made(before), ['GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f']);
});

test('the pace: a quiet day and an hour of watering stay far under the daily budget', async () => {
  const ctx = await setup();
  const { state } = ctx;
  const start = FIXTURE_NOW + 6 * 60 * MINUTE;
  const reads = [];
  await advance(ctx, 24 * 60, async (now) => {
    if (now === start + 3 * MINUTE) {
      state.runs[FRONT] = running(LAWN, now, 3600);
    } else if (now === start + 63 * MINUTE) {
      state.runs[FRONT] = {};
    }
  });
  for (const call of fake.calls) {
    reads.push(call.path);
  }
  const accounts = reads.filter((p) => /^person\/7a3c/.test(p)).length;
  const schedules = reads.filter((p) => /current_schedule$/.test(p)).length;
  // One account read every 10 minutes (plus the start), one schedule with it,
  // and every 2 minutes during the hour of watering.
  assert.equal(accounts, 1 + 144);
  assert.equal(schedules, 145 + 22, 'every 2 minutes from 372 to 424, base minutes counted once');
  assert.ok(fake.calls.length < 350, `${fake.calls.length} calls a day`);
});

test('watering seen: the events, the zone switch, the 2-minute watch, then the end', async () => {
  const ctx = await setup();
  const { gladys, state, clock } = ctx;
  await advance(ctx, 3);
  state.runs[FRONT] = running(LAWN, clock.now, 600);
  const before = fake.calls.length;
  await advance(ctx, 7); // the next account read is 10 minutes after the start
  assert.equal(made(before).filter((c) => c.endsWith('current_schedule')).length, 1);
  const started = gladys.fake.sceneEvents.find((e) => e.key === SCENE_TRIGGERS.STARTED);
  assert.equal(started.data.zone, zoneDevice(LAWN));
  assert.equal(started.data.controller, CONTROLLER);
  assert.equal(started.data.duration_minutes, 10);
  assert.equal(gladys.fake.lastState(`${zoneDevice(LAWN)}:watering`), 1);
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:current_zone`), 'Front lawn');
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:remaining_minutes`), 3);
  // While watering: the schedule every 2 minutes, the account still every 10.
  const watch = fake.calls.length;
  await advance(ctx, 2);
  assert.deepEqual(made(watch), [`GET device/${FRONT}/current_schedule`]);
  state.runs[FRONT] = {};
  await advance(ctx, 2);
  const finished = gladys.fake.sceneEvents.find((e) => e.key === SCENE_TRIGGERS.FINISHED);
  assert.equal(finished.data.zone_name, 'Front lawn');
  assert.equal(finished.data.minutes, 10, 'at most the planned duration');
  assert.equal(gladys.fake.lastState(`${zoneDevice(LAWN)}:watering`), 0);
  assert.equal(gladys.fake.sceneEvents.length, 2, 'one event per transition');
  // Back to the quiet pace: nothing until the next account read.
  const quietFrom = fake.calls.length;
  await advance(ctx, 5);
  assert.deepEqual(made(quietFrom), []);
});

test('the zone switch waters for the default time, off stops; the standby switch', async () => {
  const { gladys, timers, state, clock } = await setup({
    config: { ...CONFIG, default_minutes: 15 },
  });
  const lawn = device(gladys, zoneDevice(LAWN));
  const before = fake.calls.length;
  const ack = await gladys.fake.setValue(lawn, featureOf(lawn, 'watering'), 1);
  assert.equal(ack.success, true);
  assert.deepEqual(fake.calls[before].body, { id: LAWN, duration: 900 });
  assert.equal(gladys.fake.lastState(`${zoneDevice(LAWN)}:watering`), 1);
  // Read back once the command reached the controller.
  assert.equal(timers.timeouts()[0].ms, 20_000);
  state.runs[FRONT] = running(LAWN, clock.now, 900);
  await timers.runTimeouts();
  assert.equal(made(before).at(-1), `GET device/${FRONT}/current_schedule`);
  assert.equal(gladys.fake.sceneEvents.at(-1).key, SCENE_TRIGGERS.STARTED);

  const stop = fake.calls.length;
  await gladys.fake.setValue(lawn, featureOf(lawn, 'watering'), 0);
  assert.deepEqual(made(stop), ['PUT device/stop_water']);
  assert.deepEqual(fake.calls[stop].body, { id: FRONT });

  const front = device(gladys, CONTROLLER);
  const standby = fake.calls.length;
  await gladys.fake.setValue(front, featureOf(front, 'on'), 0);
  assert.deepEqual(made(standby), ['PUT device/off']);
  assert.equal(gladys.fake.lastState(`${CONTROLLER}:on`), 0);
  await timers.runTimeouts();
  assert.ok(made(standby).includes('GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f'));

  const wrong = await gladys.fake.setValue(front, featureOf(front, 'watering'), 1);
  assert.equal(wrong.success, false, 'the controller watering state is read-only');
});

test('a start whose run never shows up is watched five minutes, no longer', async () => {
  const ctx = await setup();
  await ctx.gladys.fake.sceneAction(SCENE_ACTIONS.WATER_ZONE, { zone: zoneDevice(LAWN) });
  await ctx.timers.runTimeouts(); // the read back: still idle
  const from = fake.calls.length;
  await advance(ctx, 9);
  assert.deepEqual(
    made(from),
    Array(3).fill(`GET device/${FRONT}/current_schedule`),
    'at minutes 2, 4 and 6, then back to the quiet pace',
  );
});

test('scene actions: water one or several zones, schedules, stop, rain delay', async () => {
  const { gladys } = await setup();
  const run = async (key, fields) => {
    const from = fake.calls.length;
    const ack = await gladys.fake.sceneAction(key, fields);
    return { ack, calls: fake.calls.slice(from) };
  };
  let r = await run(SCENE_ACTIONS.WATER_ZONE, { zone: zoneDevice(BEDS), minutes: 5 });
  assert.deepEqual(r.ack.data.outputs, {
    zone_name: 'Flower beds',
    controller_name: 'Front yard',
    minutes: 5,
  });
  assert.deepEqual(r.calls[0].body, { id: BEDS, duration: 300 });
  r = await run(SCENE_ACTIONS.WATER_ZONE, { zone: 'front LAWN' });
  assert.deepEqual(r.calls[0].body, { id: LAWN, duration: 600 }, 'a typed name, the default time');

  r = await run(SCENE_ACTIONS.WATER_ZONES, {
    zones: [zoneDevice(HEDGE), zoneDevice(ORCHARD), zoneDevice(LAWN), zoneDevice(VEG)],
    minutes: 2,
  });
  assert.deepEqual(r.ack.data.outputs, { count: 4, total_minutes: 8 });
  assert.deepEqual(
    r.calls.map((c) => c.body),
    [
      {
        zones: [
          { id: LAWN, duration: 120, sortOrder: 0 },
          { id: HEDGE, duration: 120, sortOrder: 1 },
        ],
      },
      {
        zones: [
          { id: VEG, duration: 120, sortOrder: 0 },
          { id: ORCHARD, duration: 120, sortOrder: 1 },
        ],
      },
    ],
    'one call per controller, in zone order',
  );

  r = await run(SCENE_ACTIONS.RUN_SCHEDULE, { schedule: 'lawn' });
  assert.deepEqual(
    r.calls.map((c) => [c.path, c.body]),
    [['schedulerule/start', { id: LAWN_SCHEDULE }]],
  );
  assert.deepEqual(r.ack.data.outputs, {
    schedule_name: 'Lawn',
    controller_name: 'Front yard',
    minutes: 45,
  });
  r = await run(SCENE_ACTIONS.SKIP_SCHEDULE, { schedule: 'Flex daily', controller: CONTROLLER });
  assert.deepEqual(
    r.calls.map((c) => [c.path, c.body]),
    [['schedulerule/skip', { id: FLEX_SCHEDULE }]],
  );

  r = await run(SCENE_ACTIONS.STOP, {});
  assert.deepEqual(
    r.calls.map((c) => [c.path, c.body]),
    [['device/stop_water', { id: FRONT }]],
  );
  assert.equal(r.ack.data.outputs.stopped, 1, 'every online controller');

  r = await run(SCENE_ACTIONS.RAIN_DELAY, {
    hours: 48,
    controller: `ext:rachio:controller:${BACK}`,
  });
  assert.deepEqual(
    r.calls.map((c) => [c.path, c.body]),
    [['device/rain_delay', { id: BACK, duration: 172800 }]],
  );
  assert.equal(r.ack.data.outputs.until, new Date(FIXTURE_NOW + 48 * 3_600_000).toISOString());
  r = await run(SCENE_ACTIONS.RAIN_DELAY, { hours: 0 });
  assert.deepEqual(r.calls[0].body, { id: FRONT, duration: 0 }, '0 cancels');
  assert.equal(r.ack.data.outputs.until, null);

  const failures = [
    [SCENE_ACTIONS.WATER_ZONE, { zone: 'the moon' }, /Unknown Rachio zone/],
    [SCENE_ACTIONS.WATER_ZONES, { zones: [] }, /at least one/],
    [SCENE_ACTIONS.RUN_SCHEDULE, { schedule: 'nope' }, /Unknown Rachio schedule/],
    [SCENE_ACTIONS.RAIN_DELAY, { hours: '' }, /hours is required/],
    [SCENE_ACTIONS.STOP, { controller: 'garage' }, /Unknown Rachio controller/],
  ];
  for (const [key, fields, error] of failures) {
    const ack = await gladys.fake.sceneAction(key, fields);
    assert.equal(ack.success, false, key);
    assert.match(ack.error, error);
  }
  assert.equal(gladys.fake.sceneEvents.length, 0, 'an action fires no event by itself');
});

test('the garden widget and its buttons', async () => {
  const { gladys, state, clock, timers } = await setup();
  state.runs[FRONT] = running(LAWN, clock.now - 2 * MINUTE, 600);
  await timers.runTimeouts();
  await advance({ clock, timers }, 10);
  const widget = await gladys.fake.widgetGet(WIDGETS.GARDEN, { settings: {}, language: 'fr' });
  const content = widget.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].text, 'Front yard', 'the first controller by default');
  const back = await gladys.fake.widgetGet(WIDGETS.GARDEN, {
    settings: { controller: `ext:rachio:controller:${BACK}` },
  });
  assert.equal(back.data.content.components[0].text, 'Back yard');

  const tap = async (action, values) => {
    const from = fake.calls.length;
    const ack = await gladys.fake.widgetAction(
      WIDGETS.GARDEN,
      action,
      { controller: FRONT },
      { settings: {}, values },
    );
    return { message: ack.data.message, calls: fake.calls.slice(from) };
  };
  let r = await tap(WIDGET_ACTIONS.START, { zone: BEDS, minutes: 3 });
  assert.deepEqual(
    r.calls.map((c) => c.body),
    [{ id: BEDS, duration: 180 }],
  );
  assert.equal(r.message.fr, 'Flower beds : arrosage pendant 3 min');
  r = await tap(WIDGET_ACTIONS.START, undefined);
  assert.match(r.message.en, /Update Gladys/);
  assert.equal(r.calls.length, 0);
  r = await tap(WIDGET_ACTIONS.STOP);
  assert.deepEqual(
    r.calls.map((c) => c.path),
    ['device/stop_water'],
  );
  r = await tap(WIDGET_ACTIONS.SCHEDULE, { schedule: LAWN_SCHEDULE });
  assert.deepEqual(
    r.calls.map((c) => c.body),
    [{ id: LAWN_SCHEDULE }],
  );
  r = await tap(WIDGET_ACTIONS.RAIN_DELAY, { hours: 0 });
  assert.deepEqual(
    r.calls.map((c) => c.body),
    [{ id: FRONT, duration: 0 }],
  );
  assert.equal(r.message.en, 'Rain delay canceled');
  fake.restore();
  fake = installFetch([['PUT', /./, () => json({ error: 'Missing data', code: 301 }, 400)]]);
  r = await tap(WIDGET_ACTIONS.STOP);
  assert.match(
    r.message.en,
    /Rachio refused: HTTP 400 on \/1\/public\/device\/stop_water: Missing data/,
  );
});

test('API key refused: the status says so and the loop stops', async () => {
  const { gladys, timers } = await setup({
    create: false,
    routes: [['GET', /^person\/info$/, () => json(fixture('unauthorized.json'), 401)]],
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.equal(timers.intervals().length, 0);
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('k3y-1234'));
  const test = await gladys.fake.action(ACTIONS.TEST);
  assert.match(test.data.message.fr, /a refusé la clé/);
});

test('Rachio down: unreachable, the loop keeps running and recovers', async () => {
  const down = { on: true };
  const ctx = await setup({
    create: false,
    routes: [['GET', /^person\//, () => (down.on ? json({ error: 'boom' }, 503) : PASS)]],
  });
  const { gladys, timers } = ctx;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: HTTP 503 on .*: boom/);
  assert.equal(timers.intervals().length, 1);
  // Retried at the refresh pace, not at every tick.
  fake.calls.length = 0;
  await advance(ctx, 9);
  assert.equal(fake.calls.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false, 'a quiet tick keeps the status');
  down.on = false;
  await advance(ctx, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /Connected to Rachio/);
});

test('a low budget slows the loop down, a spent one pauses it until the reset', async () => {
  const budget = { limit: 1700, remaining: 104, reset: '2026-10-14T00:00:00Z' };
  const limited = { on: false };
  const ctx = await setup({
    budget,
    routes: [
      [
        'GET',
        /^person\/7a3c/,
        () => (limited.on ? json({ errors: [{ message: 'Too many requests' }] }, 429) : PASS),
      ],
    ],
  });
  const { gladys, clock } = ctx;
  assert.equal(budget.remaining, 101, 'three calls at start');
  fake.calls.length = 0;
  await advance(ctx, 10);
  assert.equal(fake.calls.length, 2, 'the account and the schedule at the 10th minute');
  assert.match(gladys.fake.connectionStatus.message.en, /budget almost spent.*\(00:00 UTC\)/);
  await advance(ctx, 50);
  assert.equal(fake.calls.length, 2, 'nothing more for an hour');
  await advance(ctx, 10);
  assert.deepEqual(
    made(2),
    ['GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f'],
    'no schedule read',
  );
  limited.on = true;
  await advance(ctx, 60);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /limit reached: reading paused until 00:00 UTC/,
  );
  const paused = fake.calls.length;
  await advance(ctx, 60);
  assert.equal(fake.calls.length, paused, 'paused until the reset');
  limited.on = false;
  clock.now = Date.parse('2026-10-14T00:00:30Z');
  await advance(ctx, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true, 'back after the reset');
  assert.match(gladys.fake.connectionStatus.message.en, /Connected to Rachio/);
});

test('Gladys Plus webhooks: registered, events refresh with a cooldown, removed when unlinked', async () => {
  const ctx = await setup({
    create: false,
    webhooks: {
      available: true,
      webhooks: [{ key: 'events', mode: 'fire_and_forget', url: RELAY }],
    },
    routes: [],
  });
  const { gladys, app, timers, state } = ctx;
  const externalId = webhookExternalId(RELAY);
  // Start again with the account's existing webhooks: another app's and a stale one of ours.
  state.webhooks[FRONT] = fixture('device-webhooks.json');
  fake.calls.length = 0;
  await app.start(CONFIG);
  assert.deepEqual(made(), [
    'GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f',
    `GET device/${FRONT}/current_schedule`,
    'GET notification/webhook_event_type',
    `GET notification/${FRONT}/webhook`,
    'DELETE notification/webhook/aa11bb22-0000-4000-8000-000000000002',
    'POST notification/webhook',
    `GET notification/${BACK}/webhook`,
    'POST notification/webhook',
  ]);
  assert.deepEqual(fake.calls.find((c) => c.method === 'POST').body, {
    device: { id: FRONT },
    externalId,
    url: RELAY,
    eventTypes: ['5', '6', '9', '10', '11'].map((id) => ({ id })),
  });
  assert.match(gladys.fake.connectionStatus.message.en, /real-time events through Gladys Plus/);

  const event = { ...fixture('webhook-zone-started.json'), externalId };
  state.runs[FRONT] = running(LAWN, ctx.clock.now, 600);
  fake.calls.length = 0;
  await gladys.fake.webhook(WEBHOOKS.EVENTS, { method: 'POST', body: JSON.stringify(event) });
  assert.deepEqual(made(), [
    'GET person/7a3c5e10-2b4d-4f6a-8c9e-0a1b2c3d4e5f',
    `GET device/${FRONT}/current_schedule`,
  ]);
  assert.equal(gladys.fake.sceneEvents.at(-1).key, SCENE_TRIGGERS.STARTED);
  // A burst: one trailing refresh at the end of the cooldown.
  await gladys.fake.webhook(WEBHOOKS.EVENTS, { body: event });
  await gladys.fake.webhook(WEBHOOKS.EVENTS, { body: event });
  assert.equal(fake.calls.length, 2);
  assert.equal(timers.timeouts().length, 1);
  await timers.runTimeouts();
  assert.equal(fake.calls.length, 4);
  // Not ours: ignored.
  await gladys.fake.webhook(WEBHOOKS.EVENTS, { body: { ...event, externalId: 'another-app' } });
  assert.equal(fake.calls.length, 4);

  state.webhooks[FRONT] = [{ id: 'ours', url: RELAY, externalId }];
  fake.calls.length = 0;
  await gladys.fake.webhookUpdated({ available: false, webhooks: [] });
  assert.deepEqual(made(), [
    `GET notification/${FRONT}/webhook`,
    'DELETE notification/webhook/ours',
    `GET notification/${BACK}/webhook`,
  ]);
  assert.match(gladys.fake.connectionStatus.message.en, /2 controllers, 5 zones\.$/);
});

test('the test button lists the account and the budget', async () => {
  const { gladys } = await setup({
    create: false,
    budget: { limit: 1700, remaining: 1650, reset: '2026-10-14T00:00:00Z' },
  });
  const test = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(
    test.data.message.en,
    [
      'Front yard: online, 3 zones, schedules: Lawn, Flowers, Flex Daily.',
      'Back yard: OFFLINE, standby, 2 zones, no schedule.',
      'API budget: 1646 of 1700 calls left today.',
      'Real-time events: none (no Gladys Plus webhook), polling only.',
    ].join('\n'),
  );
});
