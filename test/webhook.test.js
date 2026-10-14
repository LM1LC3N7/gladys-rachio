import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webhookEventTypesOf, webhooksOf } from '../src/rachio/model.js';
import {
  WEBHOOK_PREFIX,
  eventTypeIds,
  inboundEvent,
  planWebhooks,
  webhookExternalId,
} from '../src/webhook.js';
import { BACK, FRONT, fixture } from './helpers/fakeFetch.js';

const URL_A = 'https://plus.example.invalid/webhook/aaa';

test('the externalId marks our webhooks and changes with the relay URL', () => {
  const id = webhookExternalId(URL_A);
  assert.match(id, /^gladys-rachio:[0-9a-f]{16}$/);
  assert.equal(webhookExternalId(URL_A), id, 'stable without any storage');
  assert.notEqual(webhookExternalId('https://plus.example.invalid/webhook/bbb'), id);
  assert.ok(id.startsWith(WEBHOOK_PREFIX));
});

test('the event types: the known names, else everything but the deltas', () => {
  const types = webhookEventTypesOf(fixture('webhook-event-types.json'));
  assert.deepEqual(eventTypeIds(types), ['5', '6', '9', '10', '11']);
  const renamed = [
    { id: '1', name: 'SOMETHING_NEW' },
    { id: '2', name: 'ZONE_DELTA' },
  ];
  assert.deepEqual(eventTypeIds(renamed), ['1']);
  assert.deepEqual(eventTypeIds([]), []);
});

test('the plan keeps ours when current, replaces a stale one, never touches the others', () => {
  const existing = webhooksOf(fixture('device-webhooks.json'));
  const target = { url: URL_A, externalId: webhookExternalId(URL_A) };
  assert.deepEqual(planWebhooks(existing, target), {
    remove: ['aa11bb22-0000-4000-8000-000000000002'],
    add: true,
  });
  const current = [...existing, { id: 'ours', ...target }];
  assert.deepEqual(planWebhooks(current, target), {
    remove: ['aa11bb22-0000-4000-8000-000000000002'],
    add: false,
  });
  assert.deepEqual(planWebhooks(current, undefined), {
    remove: ['aa11bb22-0000-4000-8000-000000000002', 'ours'],
    add: false,
  });
});

test('an inbound event: ours and for a known controller, else ignored', () => {
  const externalId = webhookExternalId(URL_A);
  const event = { ...fixture('webhook-zone-started.json'), externalId };
  const options = { externalId, controllerIds: [FRONT, BACK] };
  assert.deepEqual(inboundEvent({ body: event }, options), {
    ok: true,
    deviceId: FRONT,
    type: 'ZONE_STATUS',
    subType: 'ZONE_STARTED',
  });
  assert.equal(inboundEvent({ body: JSON.stringify(event) }, options).ok, true, 'a raw JSON body');
  assert.match(inboundEvent({ body: '{nope' }, options).reason, /not JSON/);
  assert.match(inboundEvent({ body: { hello: 1 } }, options).reason, /not a Rachio event/);
  assert.match(
    inboundEvent({ body: { ...event, externalId: 'another-app' } }, options).reason,
    /not one of our webhooks/,
  );
  assert.match(
    inboundEvent({ body: event }, { externalId: undefined, controllerIds: [FRONT] }).reason,
    /not one of our webhooks/,
    'no relay URL known: nothing is accepted',
  );
  assert.match(
    inboundEvent({ body: { ...event, deviceId: 'someone' } }, options).reason,
    /unknown controller/,
  );
});
