// -----------------------------------------------------------------------------
// Rachio JSON -> plain values. Pure: `now` is a parameter (milliseconds).
//
// BUILT BLIND: the field names below come from the public documentation
// (https://rachio.readme.io/reference) and its examples, not from a real
// account. Every one of them lives in this file (the request bodies live in
// client.js), so a user report fixes one place. TODO.md lists them.
//
//   person/info              { id }
//   person/{id}              { id, username, fullName, devices: [device] }
//   device                   { id, name, status: ONLINE|OFFLINE, on, paused,
//                              deleted, model, serialNumber, timeZone,
//                              rainDelayExpirationDate (ms), zones,
//                              scheduleRules, flexScheduleRules }
//   zone                     { id, zoneNumber, name, enabled, maxRuntime (s),
//                              lastWateredDate (ms), lastWateredDuration (s)? }
//   schedule rule            { id, name, externalName, enabled, summary,
//                              totalDuration (s) }
//   device/{id}/current_schedule
//                            {} when idle, else { deviceId, scheduleId, type,
//                              status, startDate (ms), duration (s), zoneId,
//                              zoneNumber?, zoneStartDate (ms), zoneDuration (s) }
//   headers                  X-RateLimit-Limit / -Remaining / -Reset
//   errors                   { errors: [{ message }] } or { error, code }
//   notification webhooks    { id, url, externalId, eventTypes }
//   webhook event types      [{ id, name, description, type }]
//   webhook event            { externalId, deviceId, type, subType, ... }
// -----------------------------------------------------------------------------

const num = (value) => {
  const n = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(n) ? null : n;
};

/** Rachio dates are epoch milliseconds; a few answers use ISO strings. */
const isoOf = (value) => {
  const n = num(value);
  const ms = n !== null ? n : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};

/** Lower-case, no accents, single spaces: how a typed name is compared. */
export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// --- Account ------------------------------------------------------------------------

/** The person id of the key (person/info). */
export function personIdOf(info) {
  return info?.id ? String(info.id) : undefined;
}

export function zoneOf(raw) {
  const number = num(raw.zoneNumber);
  return {
    id: String(raw.id),
    number,
    name: String(raw.name ?? '').trim() || `Zone ${number ?? '?'}`,
    enabled: raw.enabled !== false,
    maxSeconds: num(raw.maxRuntime),
    lastWateredAt: isoOf(raw.lastWateredDate),
    lastWateredSeconds: num(raw.lastWateredDuration),
  };
}

export function scheduleOf(raw, flex = false) {
  return {
    id: String(raw.id),
    name:
      String(raw.name ?? '').trim() ||
      String(raw.externalName ?? '').trim() ||
      String(raw.summary ?? '').trim() ||
      String(raw.id),
    enabled: raw.enabled !== false,
    flex,
    summary: raw.summary ? String(raw.summary) : null,
    totalSeconds: num(raw.totalDuration),
  };
}

export function controllerOf(raw) {
  const byNumber = (a, b) => (a.number ?? 999) - (b.number ?? 999);
  return {
    id: String(raw.id),
    name: String(raw.name ?? '').trim() || `Rachio ${raw.serialNumber ?? raw.id}`,
    online: String(raw.status ?? '').toUpperCase() === 'ONLINE',
    on: raw.on !== false,
    model: raw.model ? String(raw.model) : null,
    serial: raw.serialNumber ? String(raw.serialNumber) : null,
    timeZone: raw.timeZone ? String(raw.timeZone) : null,
    rainDelayUntil: isoOf(raw.rainDelayExpirationDate),
    zones: (raw.zones ?? [])
      .filter((z) => z?.id)
      .map(zoneOf)
      .sort(byNumber),
    schedules: [
      ...(raw.scheduleRules ?? []).filter((s) => s?.id).map((s) => scheduleOf(s, false)),
      ...(raw.flexScheduleRules ?? []).filter((s) => s?.id).map((s) => scheduleOf(s, true)),
    ],
  };
}

/** The controllers of a person (deleted ones left out). */
export function controllersOf(person) {
  return (person?.devices ?? []).filter((d) => d?.id && d.deleted !== true).map(controllerOf);
}

// --- Watering -----------------------------------------------------------------------

/**
 * The run of device/{id}/current_schedule: null when idle (Rachio answers
 * `{}`), else the zone watering now and when the run ends.
 */
export function runOf(raw) {
  if (!raw || typeof raw !== 'object' || !raw.zoneId) {
    return null;
  }
  const startedAt = isoOf(raw.startDate);
  const zoneStartedAt = isoOf(raw.zoneStartDate) ?? startedAt;
  const durationSeconds = num(raw.duration) ?? num(raw.zoneDuration) ?? 0;
  const zoneDurationSeconds = num(raw.zoneDuration) ?? durationSeconds;
  const end = (start, seconds) =>
    start ? new Date(Date.parse(start) + seconds * 1000).toISOString() : null;
  return {
    zoneId: String(raw.zoneId),
    zoneNumber: num(raw.zoneNumber),
    scheduleId: raw.scheduleId ? String(raw.scheduleId) : null,
    type: raw.type ? String(raw.type) : null,
    startedAt,
    durationSeconds,
    endsAt: end(startedAt, durationSeconds),
    zoneStartedAt,
    zoneDurationSeconds,
    zoneEndsAt: end(zoneStartedAt, zoneDurationSeconds),
  };
}

/** Whole minutes left before `iso`, rounded up, never negative. */
export function minutesUntil(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 60_000)) : 0;
}

/**
 * The reading of a controller: what the devices, the triggers and the widget
 * show. `run` is the last known run (runOf) or null.
 */
export function readingOf(controller, run, now) {
  const delay =
    controller.rainDelayUntil && Date.parse(controller.rainDelayUntil) > now
      ? controller.rainDelayUntil
      : null;
  let current = null;
  if (run) {
    const zone = controller.zones.find((z) => z.id === run.zoneId);
    current = {
      ...run,
      zoneName: zone?.name ?? `Zone ${run.zoneNumber ?? '?'}`,
      zoneNumber: run.zoneNumber ?? zone?.number ?? null,
      remainingMinutes: minutesUntil(run.endsAt, now),
      zoneRemainingMinutes: minutesUntil(run.zoneEndsAt, now),
    };
  }
  return {
    readAt: new Date(now).toISOString(),
    online: controller.online,
    on: controller.on,
    rainDelayUntil: delay,
    rainDelayHours: delay ? Math.ceil((Date.parse(delay) - now) / 3_600_000) : 0,
    run: current,
  };
}

/** A schedule by id or by (folded) name, among the given controllers. */
export function findSchedule(controllers, query) {
  const text = String(query ?? '').trim();
  if (!text) {
    return undefined;
  }
  const wanted = fold(text);
  for (const controller of controllers) {
    const schedule =
      controller.schedules.find((s) => s.id === text) ??
      controller.schedules.find((s) => fold(s.name) === wanted);
    if (schedule) {
      return { controller, schedule };
    }
  }
  for (const controller of controllers) {
    const schedule = controller.schedules.find((s) => fold(s.name).includes(wanted));
    if (schedule) {
      return { controller, schedule };
    }
  }
  return undefined;
}

// --- HTTP details -----------------------------------------------------------------------

/** The daily budget of the key, from the answer headers (any of them). */
export function rateLimitOf(headers) {
  const get = (name) => (typeof headers?.get === 'function' ? headers.get(name) : null);
  const limit = num(get('x-ratelimit-limit'));
  const remaining = num(get('x-ratelimit-remaining'));
  if (limit === null && remaining === null) {
    return undefined;
  }
  const reset = Date.parse(get('x-ratelimit-reset') ?? '');
  return {
    limit,
    remaining,
    resetAt: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
  };
}

/** The message of a Rachio error body, when there is one. */
export function errorMessageOf(body) {
  if (typeof body === 'string') {
    return body.slice(0, 200) || undefined;
  }
  const message = body?.errors?.[0]?.message ?? body?.error ?? body?.message;
  return message ? String(message).slice(0, 200) : undefined;
}

// --- Notification webhooks ------------------------------------------------------------------

export function webhookEventTypesOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((t) => t?.id !== undefined && t?.name)
    .map((t) => ({ id: String(t.id), name: String(t.name) }));
}

export function webhooksOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((w) => w?.id)
    .map((w) => ({
      id: String(w.id),
      url: String(w.url ?? ''),
      externalId: String(w.externalId ?? ''),
    }));
}

/** The fields of a received webhook event the integration looks at. */
export function webhookEventOf(body) {
  if (!body || typeof body !== 'object' || !body.deviceId) {
    return undefined;
  }
  return {
    externalId: body.externalId === undefined ? undefined : String(body.externalId),
    deviceId: String(body.deviceId),
    type: body.type ? String(body.type) : null,
    subType: body.subType ? String(body.subType) : null,
  };
}
