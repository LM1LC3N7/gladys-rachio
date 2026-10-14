// -----------------------------------------------------------------------------
// Two consecutive readings of a controller -> scene events. Pure. Nothing
// fires on the first reading (no transition without a previous value), and
// a transition fires once: the next reading compares with the new state.
// -----------------------------------------------------------------------------

import { RAIN_DELAY_EVENTS, SCENE_TRIGGERS, STATUS_EVENTS } from './constants.js';

/** More than this between two rain delay ends is a new delay, not the same one. */
const RAIN_DELAY_TOLERANCE = 5 * 60_000;

const minutes = (seconds) => Math.max(0, Math.round((seconds ?? 0) / 60));

/**
 * The events of a controller between two readings.
 * `target` is { controller: device external id, name, zone: (zoneId) =>
 * zone device external id }; `now` dates the end of a run.
 */
export function controllerEvents(target, previous, current, now) {
  const events = [];
  if (!previous) {
    return events;
  }
  const base = { controller: target.controller, controller_name: target.name };

  if (previous.online !== current.online) {
    events.push({
      key: SCENE_TRIGGERS.STATUS,
      data: { ...base, event: current.online ? STATUS_EVENTS.ONLINE : STATUS_EVENTS.OFFLINE },
    });
  }

  const before = previous.rainDelayUntil ? Date.parse(previous.rainDelayUntil) : null;
  const after = current.rainDelayUntil ? Date.parse(current.rainDelayUntil) : null;
  if (after !== null && (before === null || Math.abs(after - before) > RAIN_DELAY_TOLERANCE)) {
    events.push({
      key: SCENE_TRIGGERS.RAIN_DELAY,
      data: {
        ...base,
        event: RAIN_DELAY_EVENTS.SET,
        until: current.rainDelayUntil,
        hours: current.rainDelayHours,
      },
    });
  } else if (after === null && before !== null) {
    events.push({
      key: SCENE_TRIGGERS.RAIN_DELAY,
      data: { ...base, event: RAIN_DELAY_EVENTS.CLEARED, until: null, hours: 0 },
    });
  }

  const was = previous.run;
  const is = current.run;
  if (was && was.zoneId !== is?.zoneId) {
    // Watered from the zone start until now, at most the planned duration.
    const start = was.zoneStartedAt ? Date.parse(was.zoneStartedAt) : now;
    const watered = Math.min(was.zoneDurationSeconds, Math.max(0, (now - start) / 1000));
    events.push({
      key: SCENE_TRIGGERS.FINISHED,
      data: {
        ...base,
        zone: target.zone(was.zoneId),
        zone_name: was.zoneName,
        zone_number: was.zoneNumber,
        minutes: minutes(watered),
        finished_at: new Date(now).toISOString(),
      },
    });
  }
  if (is && is.zoneId !== was?.zoneId) {
    events.push({
      key: SCENE_TRIGGERS.STARTED,
      data: {
        ...base,
        zone: target.zone(is.zoneId),
        zone_name: is.zoneName,
        zone_number: is.zoneNumber,
        duration_minutes: minutes(is.zoneDurationSeconds),
        started_at: is.zoneStartedAt,
      },
    });
  }
  return events;
}
