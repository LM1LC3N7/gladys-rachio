import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_TRIGGERS } from '../src/constants.js';
import { controllersOf, readingOf, runOf } from '../src/rachio/model.js';
import { controllerEvents } from '../src/triggers.js';
import { BEDS, FIXTURE_NOW, LAWN, fixture, running } from './helpers/fakeFetch.js';

const [front] = controllersOf(fixture('person.json'));
const target = {
  controller: 'ext:rachio:controller:front',
  name: 'Front yard',
  zone: (id) => `z:${id}`,
};
const minute = 60_000;
const read = (overrides = {}, run = null, now = FIXTURE_NOW) =>
  readingOf({ ...front, ...overrides }, run ? runOf(run) : null, now);

test('the first reading fires nothing, an unchanged one neither', () => {
  const watering = read({}, running(LAWN, FIXTURE_NOW - 2 * minute));
  assert.deepEqual(controllerEvents(target, undefined, watering, FIXTURE_NOW), []);
  const later = read({}, running(LAWN, FIXTURE_NOW - 2 * minute), FIXTURE_NOW + 2 * minute);
  assert.deepEqual(controllerEvents(target, watering, later, FIXTURE_NOW + 2 * minute), []);
});

test('watering started, then the next zone, then finished: one event per transition', () => {
  const idle = read();
  const lawn = read({}, running(LAWN, FIXTURE_NOW, 600));
  const started = controllerEvents(target, idle, lawn, FIXTURE_NOW);
  assert.equal(started.length, 1);
  assert.equal(started[0].key, SCENE_TRIGGERS.STARTED);
  assert.deepEqual(started[0].data, {
    controller: 'ext:rachio:controller:front',
    controller_name: 'Front yard',
    zone: `z:${LAWN}`,
    zone_name: 'Front lawn',
    zone_number: 1,
    duration_minutes: 10,
    started_at: new Date(FIXTURE_NOW).toISOString(),
  });

  const at = FIXTURE_NOW + 10 * minute;
  const beds = read({}, running(BEDS, at, 300), at);
  const handover = controllerEvents(target, lawn, beds, at);
  assert.deepEqual(
    handover.map((e) => [e.key, e.data.zone_name]),
    [
      [SCENE_TRIGGERS.FINISHED, 'Front lawn'],
      [SCENE_TRIGGERS.STARTED, 'Flower beds'],
    ],
  );
  assert.equal(handover[0].data.minutes, 10);

  // Stopped after 2 minutes: the minutes watered, not the planned ones.
  const end = at + 2 * minute;
  const finished = controllerEvents(target, beds, read({}, null, end), end);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].key, SCENE_TRIGGERS.FINISHED);
  assert.equal(finished[0].data.minutes, 2);
  assert.equal(finished[0].data.finished_at, new Date(end).toISOString());
});

test('rain delay set, extended, cleared; controller offline and back', () => {
  const until = (hours) => new Date(FIXTURE_NOW + hours * 3_600_000).toISOString();
  const none = read({ rainDelayUntil: null });
  const day = read({ rainDelayUntil: until(24) });
  const set = controllerEvents(target, none, day, FIXTURE_NOW);
  assert.equal(set.length, 1);
  assert.equal(set[0].key, SCENE_TRIGGERS.RAIN_DELAY);
  assert.equal(set[0].data.event, 'set');
  assert.equal(set[0].data.hours, 24);
  assert.equal(set[0].data.until, until(24));
  // The same delay read again a minute later: nothing.
  assert.deepEqual(
    controllerEvents(target, day, read({ rainDelayUntil: until(24) }), FIXTURE_NOW),
    [],
  );
  const extended = controllerEvents(target, day, read({ rainDelayUntil: until(48) }), FIXTURE_NOW);
  assert.equal(extended[0].data.event, 'set');
  assert.equal(extended[0].data.hours, 48);
  const cleared = controllerEvents(target, day, none, FIXTURE_NOW);
  assert.deepEqual(cleared[0].data, {
    controller: target.controller,
    controller_name: 'Front yard',
    event: 'cleared',
    until: null,
    hours: 0,
  });

  const offline = controllerEvents(target, none, read({ online: false, rainDelayUntil: null }), 0);
  assert.deepEqual(
    offline.map((e) => [e.key, e.data.event]),
    [[SCENE_TRIGGERS.STATUS, 'offline']],
  );
  const back = controllerEvents(target, read({ online: false, rainDelayUntil: null }), none, 0);
  assert.equal(back[0].data.event, 'online');
});
