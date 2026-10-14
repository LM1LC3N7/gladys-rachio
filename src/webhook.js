// -----------------------------------------------------------------------------
// Real-time events through Gladys Plus: the Rachio "notification" webhooks.
// Pure helpers; the calls are made by the app through the client.
//
// Doctrine "trigger, not data": an event only says "this controller changed,
// read it now". Its payload is never applied as a state, so a duplicated, late
// or forged event costs at most one refresh, and a lost one is caught up by the
// next poll.
//
// Without storage on disk, the integration recognizes its own webhooks by
// their `externalId`: a fixed prefix plus a hash of the relay URL. A webhook
// with the prefix but another hash points to an old URL and is removed.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { webhookEventOf } from './rachio/model.js';

export const WEBHOOK_PREFIX = 'gladys-rachio:';

/**
 * The event types the integration subscribes to, by name (as Home Assistant
 * does). The documentation also shows older names, accepted too.
 */
export const WEBHOOK_EVENT_NAMES = [
  'DEVICE_STATUS_EVENT',
  'ZONE_STATUS_EVENT',
  'SCHEDULE_STATUS_EVENT',
  'RAIN_DELAY_EVENT',
  'RAIN_SENSOR_DETECTION_EVENT',
  'ZONE_ACTION',
  'SCHEDULE_ACTION',
];

/** The externalId that marks a webhook as ours, for this relay URL. */
export function webhookExternalId(url) {
  const hash = createHash('sha256').update(String(url)).digest('hex').slice(0, 16);
  return `${WEBHOOK_PREFIX}${hash}`;
}

/**
 * The ids of the event types to subscribe to. When none of the known names
 * is offered (renamed types), every type but the noisy "delta" ones.
 */
export function eventTypeIds(types) {
  const known = types.filter((t) => WEBHOOK_EVENT_NAMES.includes(t.name));
  const chosen = known.length > 0 ? known : types.filter((t) => !/DELTA/i.test(t.name));
  return chosen.map((t) => t.id);
}

/**
 * What to do with the webhooks of a controller. `target` is { url,
 * externalId }, or undefined to remove ours. Others' webhooks are left alone.
 *   -> { remove: [webhook ids], add: boolean }
 */
export function planWebhooks(existing, target) {
  const ours = existing.filter((w) => w.externalId.startsWith(WEBHOOK_PREFIX));
  if (!target) {
    return { remove: ours.map((w) => w.id), add: false };
  }
  const keep = ours.find((w) => w.url === target.url && w.externalId === target.externalId);
  return { remove: ours.filter((w) => w !== keep).map((w) => w.id), add: !keep };
}

/**
 * A request relayed by Gladys Plus -> the controller to refresh.
 *   -> { ok: true, deviceId, type, subType } | { ok: false, reason }
 */
export function inboundEvent(request, { externalId, controllerIds }) {
  let body = request?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { ok: false, reason: 'the body is not JSON' };
    }
  }
  const event = webhookEventOf(body);
  if (!event) {
    return { ok: false, reason: 'not a Rachio event' };
  }
  if (!externalId || event.externalId !== externalId) {
    return { ok: false, reason: 'not one of our webhooks' };
  }
  if (!controllerIds.includes(event.deviceId)) {
    return { ok: false, reason: 'unknown controller' };
  }
  return { ok: true, deviceId: event.deviceId, type: event.type, subType: event.subType };
}
