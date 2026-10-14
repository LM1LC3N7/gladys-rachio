// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   controller:<rachio device id>   a controller (online, standby, watering)
//   zone:<rachio zone id>           an enabled zone (watering switch)
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { MAX_RAIN_DELAY_HOURS } from './constants.js';

export const DEVICE_TYPES = { CONTROLLER: 'controller', ZONE: 'zone' };

/** The feature keys (the last segment of the feature external ids). Forever. */
export const FEATURE = {
  // controller
  ONLINE: 'online',
  ON: 'on',
  WATERING: 'watering',
  CURRENT_ZONE: 'current_zone',
  REMAINING: 'remaining_minutes',
  RAIN_DELAY: 'rain_delay_hours',
  // zone (WATERING is the same key, a switch there)
  LAST_WATERED: 'last_watered',
};

export const ids = {
  controller: (gladys, id) => gladys.externalId(`controller:${id}`),
  zone: (gladys, id) => gladys.externalId(`zone:${id}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** { kind: 'controller' | 'zone', id } or undefined. */
export function parseExternalId(externalId) {
  const match = /:(controller|zone):([A-Za-z0-9-]+)$/.exec(String(externalId ?? ''));
  return match ? { kind: match[1], id: match[2] } : undefined;
}

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

const text = (id, key, name) =>
  feature(id, key, name, C.TEXT, T.TEXT.TEXT, { min: 0, max: 0, keep_history: false });

export function buildControllerDevice(gladys, controller) {
  const id = ids.controller(gladys, controller.id);
  return {
    name: controller.name,
    external_id: id,
    features: [
      feature(id, FEATURE.ONLINE, 'Online', C.UNKNOWN, T.SENSOR.BINARY),
      feature(id, FEATURE.ON, 'On (off: standby)', C.SWITCH, T.SWITCH.BINARY, {
        read_only: false,
        has_feedback: true,
      }),
      feature(id, FEATURE.WATERING, 'Watering now', C.UNKNOWN, T.SENSOR.BINARY),
      text(id, FEATURE.CURRENT_ZONE, 'Zone watering now'),
      feature(id, FEATURE.REMAINING, 'Watering time left', C.DURATION, T.DURATION.INTEGER, {
        unit: U.MINUTES,
        max: 1440,
        keep_history: false,
      }),
      feature(id, FEATURE.RAIN_DELAY, 'Rain delay left', C.DURATION, T.DURATION.INTEGER, {
        unit: U.HOURS,
        max: MAX_RAIN_DELAY_HOURS,
      }),
    ],
    params: [
      { name: 'controller_id', value: controller.id },
      { name: 'model', value: controller.model ?? '' },
      { name: 'serial_number', value: controller.serial ?? '' },
    ],
  };
}

/** A zone device; `withController` prefixes the name when the account has several. */
export function buildZoneDevice(gladys, controller, zone, { withController = false } = {}) {
  const id = ids.zone(gladys, zone.id);
  return {
    name: withController ? `${zone.name} (${controller.name})` : zone.name,
    external_id: id,
    features: [
      feature(id, FEATURE.WATERING, 'Watering', C.SWITCH, T.SWITCH.BINARY, {
        read_only: false,
        has_feedback: true,
      }),
      text(id, FEATURE.LAST_WATERED, 'Last watered'),
    ],
    params: [
      { name: 'zone_id', value: zone.id },
      { name: 'controller_id', value: controller.id },
      { name: 'zone_number', value: String(zone.number ?? '') },
    ],
  };
}

/** The devices to offer: every controller and its enabled zones. */
export function discoveredDevices(gladys, controllers) {
  const withController = controllers.length > 1;
  const devices = [];
  for (const controller of controllers) {
    devices.push(buildControllerDevice(gladys, controller));
    for (const zone of controller.zones.filter((z) => z.enabled)) {
      devices.push(buildZoneDevice(gladys, controller, zone, { withController }));
    }
  }
  return devices;
}

const state = (deviceId, key, value) =>
  value === null || value === undefined
    ? []
    : [
        typeof value === 'string'
          ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
          : { device_feature_external_id: ids.feature(deviceId, key), state: value },
      ];

export function controllerStates(deviceId, reading) {
  return [
    ...state(deviceId, FEATURE.ONLINE, reading.online ? 1 : 0),
    ...state(deviceId, FEATURE.ON, reading.on ? 1 : 0),
    ...state(deviceId, FEATURE.WATERING, reading.run ? 1 : 0),
    ...state(deviceId, FEATURE.CURRENT_ZONE, reading.run ? reading.run.zoneName : '—'),
    ...state(deviceId, FEATURE.REMAINING, reading.run ? reading.run.remainingMinutes : 0),
    ...state(deviceId, FEATURE.RAIN_DELAY, reading.rainDelayHours),
  ];
}

/** "2026-10-13 06:12" in the controller's time zone (the server's without one). */
export function localTime(iso, timeZone) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '—';
  }
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
  } catch {
    return localTime(iso, undefined);
  }
  const part = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}

/** "2026-10-13 06:12 · 15 min", or "—" for a zone never watered. */
export function lastWateredText(zone, timeZone) {
  if (!zone.lastWateredAt) {
    return '—';
  }
  const when = localTime(zone.lastWateredAt, timeZone);
  return zone.lastWateredSeconds
    ? `${when} · ${Math.max(1, Math.round(zone.lastWateredSeconds / 60))} min`
    : when;
}

export function zoneStates(deviceId, controller, zone, reading) {
  return [
    ...state(deviceId, FEATURE.WATERING, reading.run?.zoneId === zone.id ? 1 : 0),
    ...state(deviceId, FEATURE.LAST_WATERED, lastWateredText(zone, controller.timeZone)),
  ];
}
