import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  FEATURE,
  controllerStates,
  discoveredDevices,
  lastWateredText,
  parseExternalId,
  zoneStates,
} from '../src/devices.js';
import { WIDGET_ACTIONS } from '../src/constants.js';
import { controllersOf, readingOf, runOf } from '../src/rachio/model.js';
import { gardenWidget } from '../src/widget.js';
import { FIXTURE_NOW, FRONT, LAWN, fixture, running } from './helpers/fakeFetch.js';

const [front, back] = controllersOf(fixture('person.json'));
const gladys = createFakeGladys({ selector: 'rachio' });

test('discovery: one device per controller and per enabled zone, ids that parse back', () => {
  const devices = discoveredDevices(gladys, [front, back]);
  assert.deepEqual(
    devices.map((d) => d.name),
    [
      'Front yard',
      'Front lawn (Front yard)',
      'Flower beds (Front yard)',
      'Hedge (Front yard)',
      'Back yard',
      'Vegetable garden (Back yard)',
      'Orchard (Back yard)',
    ],
  );
  assert.equal(devices[0].external_id, `ext:rachio:controller:${FRONT}`);
  assert.deepEqual(parseExternalId(devices[0].external_id), { kind: 'controller', id: FRONT });
  assert.deepEqual(parseExternalId(devices[1].external_id), { kind: 'zone', id: LAWN });
  assert.equal(parseExternalId('ext:rachio:something'), undefined);
  const lawn = devices[1];
  assert.deepEqual(
    lawn.features.map((f) => [f.external_id.split(':').at(-1), f.read_only]),
    [
      [FEATURE.WATERING, false],
      [FEATURE.LAST_WATERED, true],
    ],
  );
  assert.equal(lawn.params.find((p) => p.name === 'controller_id').value, FRONT);
  // One controller: the zones keep their own names.
  assert.equal(discoveredDevices(gladys, [front])[1].name, 'Front lawn');
});

test('states of a controller watering and of its zones', () => {
  const reading = readingOf(front, runOf(running(LAWN, FIXTURE_NOW - 120_000)), FIXTURE_NOW);
  const states = Object.fromEntries(
    controllerStates('c', reading).map((s) => [s.device_feature_external_id, s.text ?? s.state]),
  );
  assert.deepEqual(states, {
    'c:online': 1,
    'c:on': 1,
    'c:watering': 1,
    'c:current_zone': 'Front lawn',
    'c:remaining_minutes': 8,
    'c:rain_delay_hours': 0,
  });
  const [lawn, beds, hedge] = front.zones;
  assert.deepEqual(
    zoneStates('z', front, lawn, reading).map((s) => s.text ?? s.state),
    [1, '2026-10-12 06:00 · 15 min'],
    'the last watering in the controller time zone',
  );
  assert.deepEqual(
    zoneStates('z', front, beds, reading).map((s) => s.text ?? s.state),
    [0, '2026-10-11 06:15'],
  );
  assert.equal(lastWateredText(hedge, front.timeZone), '—');
});

test('the garden widget: valid content, zones, buttons with their forms', () => {
  const reading = readingOf(front, runOf(running(LAWN, FIXTURE_NOW - 120_000)), FIXTURE_NOW);
  const content = gardenWidget({ controller: front, reading, defaultMinutes: 12, language: 'fr' });
  assert.deepEqual(validateWidgetContent(content), [], 'rendered exactly as sent');
  assert.equal(content.ttl_seconds, 60);
  assert.equal(content.components[0].text, 'Front yard');
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => [i.label.fr ?? i.label, i.value]),
    [
      ['Contrôleur', 'Arrosage · Front lawn'],
      ['Front lawn', 'arrosage · 8 min restantes'],
      ['Flower beds', 'dernier 11/10 06:15'],
      ['Hedge', 'jamais arrosée'],
    ],
    'the disabled zone is not shown',
  );
  const buttons = content.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action.key),
    [WIDGET_ACTIONS.START, WIDGET_ACTIONS.STOP, WIDGET_ACTIONS.SCHEDULE, WIDGET_ACTIONS.RAIN_DELAY],
  );
  const [zone, minutes] = buttons[0].action.fields;
  assert.equal(zone.default, LAWN);
  assert.equal(zone.options.length, 3);
  assert.equal(minutes.default, 12);
  assert.deepEqual(buttons[0].action.params, { controller: FRONT });
  assert.deepEqual(
    buttons[2].action.fields[0].options.map((o) => o.label.en),
    ['Lawn', 'Flex Daily'],
    'only the enabled schedules',
  );
  assert.equal(buttons[3].action.fields[0].default, 24);
});

test('the garden widget idle, offline with a rain delay, and without controller', () => {
  const idle = gardenWidget({ controller: front, reading: readingOf(front, null, FIXTURE_NOW) });
  assert.deepEqual(validateWidgetContent(idle), []);
  assert.equal(idle.ttl_seconds, 300);
  assert.ok(!idle.components.some((c) => c.action?.key === WIDGET_ACTIONS.STOP));
  assert.equal(idle.components.find((c) => c.type === 'status').items[0].value, 'Idle');

  const until = new Date(FIXTURE_NOW + 30 * 3_600_000).toISOString();
  const delayed = gardenWidget({
    controller: { ...front, rainDelayUntil: until },
    reading: readingOf({ ...front, rainDelayUntil: until }, null, FIXTURE_NOW),
  });
  assert.match(
    delayed.components.find((c) => c.type === 'status').items[0].value,
    /Rain delay → 14 Oct/,
  );
  const rain = delayed.components.find((c) => c.action?.key === WIDGET_ACTIONS.RAIN_DELAY);
  assert.equal(rain.action.fields[0].default, 0, 'a running delay: the form offers to cancel it');

  const offline = gardenWidget({ controller: back, reading: readingOf(back, null, FIXTURE_NOW) });
  assert.deepEqual(validateWidgetContent(offline), []);
  assert.equal(offline.components.find((c) => c.type === 'status').items[0].value, 'Offline');

  const none = gardenWidget({ controller: undefined, reading: undefined });
  assert.match(none.components[0].text.en, /No Rachio controller/);
});
