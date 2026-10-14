// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  RAIN_DELAY_EVENTS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  STATUS_EVENTS,
  WEBHOOKS,
  WIDGETS,
} from '../src/constants.js';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import { controllersOf, readingOf, runOf } from '../src/rachio/model.js';
import { controllerEvents } from '../src/triggers.js';
import { BEDS, FIXTURE_NOW, LAWN, fixture, running } from './helpers/fakeFetch.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.location, undefined, 'no house location needed');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-rachio:${manifest.version}`);
  assert.equal(manifest.version, JSON.parse(read('package.json')).version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-rachio/main/cover.png',
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(manifest.config_schema[0].description[lang], /Unofficial|non officiel/);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  for (const field of manifest.config_schema) {
    for (const link of field.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.api_key.type, 'secret');
  assert.equal(fields.api_key.required, true);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
    assert.deepEqual([fields[key].min, fields[key].max], BOUNDS[key], key);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual(manifest.webhooks.map((w) => w.key).sort(), Object.values(WEBHOOKS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  for (const name of Object.keys(WEBHOOKS)) {
    assert.ok(index.includes(`onWebhook(WEBHOOKS.${name}`), name);
  }
  const triggers = Object.fromEntries(manifest.scene_triggers.map((t) => [t.key, t]));
  const option = (trigger, key) =>
    triggers[trigger].fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(option(SCENE_TRIGGERS.RAIN_DELAY, 'event'), Object.values(RAIN_DELAY_EVENTS));
  assert.deepEqual(option(SCENE_TRIGGERS.STATUS, 'event'), Object.values(STATUS_EVENTS));
});

test('every trigger field and variable is a key of the events the code fires', () => {
  const [front] = controllersOf(fixture('person.json'));
  const target = { controller: 'c', name: 'Front yard', zone: (id) => `z:${id}` };
  const at = (o, run, now = FIXTURE_NOW) =>
    readingOf({ ...front, ...o }, run ? runOf(run) : null, now);
  const later = FIXTURE_NOW + 600_000;
  const until = new Date(FIXTURE_NOW + 3_600_000).toISOString();
  const events = [
    ...controllerEvents(
      target,
      at({}),
      at({ rainDelayUntil: until }, running(LAWN, FIXTURE_NOW)),
      FIXTURE_NOW,
    ),
    ...controllerEvents(
      target,
      at({}, running(LAWN, FIXTURE_NOW)),
      at({ online: false }, running(BEDS, later), later),
      later,
    ),
  ];
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} is fired by the code`);
    for (const { key } of [...trigger.fields, ...trigger.variables]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
  }
});
