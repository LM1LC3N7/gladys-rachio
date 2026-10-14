import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import {
  controllersOf,
  errorMessageOf,
  findSchedule,
  minutesUntil,
  readingOf,
  runOf,
  rateLimitOf,
} from '../src/rachio/model.js';
import {
  FIXTURE_NOW,
  FLEX_SCHEDULE,
  FRONT,
  LAWN,
  LAWN_SCHEDULE,
  VEG,
  fixture,
} from './helpers/fakeFetch.js';

const controllers = () => controllersOf(fixture('person.json'));

test('a person becomes controllers, zones in zone order, schedules with the flex ones', () => {
  const list = controllers();
  assert.deepEqual(
    list.map((c) => c.name),
    ['Front yard', 'Back yard'],
    'the deleted controller is left out',
  );
  const [front, back] = list;
  assert.equal(front.id, FRONT);
  assert.equal(front.online, true);
  assert.equal(front.on, true);
  assert.equal(front.model, 'GENERATION3_8ZONE');
  assert.equal(front.timeZone, 'Europe/Paris');
  assert.equal(front.rainDelayUntil, '2026-10-01T06:00:00.000Z');
  assert.deepEqual(
    front.zones.map((z) => [z.number, z.name, z.enabled]),
    [
      [1, 'Front lawn', true],
      [2, 'Flower beds', true],
      [3, 'Hedge', true],
      [4, 'Zone 4', false],
    ],
  );
  assert.equal(front.zones[0].lastWateredAt, '2026-10-12T04:00:00.000Z');
  assert.equal(front.zones[0].lastWateredSeconds, 900);
  assert.equal(front.zones[0].maxSeconds, 10800);
  assert.equal(front.zones[2].lastWateredAt, null);
  assert.deepEqual(
    front.schedules.map((s) => [s.name, s.enabled, s.flex]),
    [
      ['Lawn', true, false],
      ['Flowers', false, false],
      ['Flex Daily', true, true],
    ],
    'an empty name falls back to externalName',
  );
  assert.equal(back.online, false);
  assert.equal(back.on, false);
  assert.equal(back.zones[0].id, VEG);
});

test('the running schedule: idle, running, and the reading built from it', () => {
  assert.equal(runOf({}), null);
  assert.equal(runOf(undefined), null);
  const run = runOf(fixture('current-schedule-running.json'));
  assert.equal(run.zoneId, LAWN);
  assert.equal(run.type, 'MANUAL');
  assert.equal(run.startedAt, '2026-10-13T04:58:00.000Z');
  assert.equal(run.endsAt, '2026-10-13T05:08:00.000Z');
  assert.equal(run.zoneDurationSeconds, 600);
  assert.equal(minutesUntil(run.endsAt, FIXTURE_NOW), 8);
  assert.equal(minutesUntil(run.endsAt, FIXTURE_NOW + 3_600_000), 0);

  const [front] = controllers();
  const watering = readingOf(front, run, FIXTURE_NOW);
  assert.equal(watering.run.zoneName, 'Front lawn');
  assert.equal(watering.run.zoneNumber, 1, 'the number comes from the zone list');
  assert.equal(watering.run.remainingMinutes, 8);
  assert.equal(watering.rainDelayUntil, null, 'a rain delay in the past is over');
  assert.equal(watering.rainDelayHours, 0);
  const delayed = readingOf(
    { ...front, rainDelayUntil: new Date(FIXTURE_NOW + 25 * 3_600_000 - 1).toISOString() },
    null,
    FIXTURE_NOW,
  );
  assert.equal(delayed.rainDelayHours, 25);
  assert.equal(delayed.run, null);
});

test('rate limit headers, error bodies and schedule lookup', () => {
  const headers = new Headers({
    'X-RateLimit-Limit': '1700',
    'X-RateLimit-Remaining': '1650',
    'X-RateLimit-Reset': 'Wed, 14 Oct 2026 00:00:00 GMT',
  });
  assert.deepEqual(rateLimitOf(headers), {
    limit: 1700,
    remaining: 1650,
    resetAt: '2026-10-14T00:00:00.000Z',
  });
  assert.equal(
    rateLimitOf(
      new Headers({ 'x-ratelimit-remaining': '4', 'x-ratelimit-reset': '2025-01-03T00:00:00Z' }),
    ).resetAt,
    '2025-01-03T00:00:00.000Z',
    'the ISO form of the documentation example works too',
  );
  assert.equal(rateLimitOf(new Headers()), undefined);
  assert.equal(errorMessageOf(fixture('unauthorized.json')), 'The client is not authorized.');
  assert.equal(errorMessageOf({ error: 'Missing data', code: 301 }), 'Missing data');
  assert.equal(errorMessageOf(undefined), undefined);

  const list = controllers();
  assert.equal(findSchedule(list, 'lawn').schedule.id, LAWN_SCHEDULE);
  assert.equal(findSchedule(list, LAWN_SCHEDULE).schedule.name, 'Lawn');
  assert.equal(findSchedule(list, 'flex').schedule.id, FLEX_SCHEDULE, 'a part of the name');
  assert.equal(findSchedule(list, 'Flex Daily').controller.id, FRONT);
  assert.equal(findSchedule(list, 'nothing'), undefined);
  assert.equal(findSchedule(list, ''), undefined);
});

test('the configuration is normalized and bounded', () => {
  assert.deepEqual(normalizeConfig(), { apiKey: '', defaultMinutes: 10, pollMinutes: 10 });
  assert.deepEqual(
    normalizeConfig({ api_key: ' "abc-123" ', default_minutes: '500', poll_interval: 1 }),
    { apiKey: 'abc-123', defaultMinutes: 180, pollMinutes: 5 },
  );
  assert.equal(normalizeConfig({ poll_interval: 'often' }).pollMinutes, 10);
  assert.equal(normalizeConfig({ default_minutes: '' }).defaultMinutes, 10);
});
