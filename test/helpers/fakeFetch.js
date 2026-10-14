// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes requests to handlers, records every
// call, adds the X-RateLimit-* headers Rachio sends, and fails loudly on an
// unexpected request. No test touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/** 2026-10-13T05:00:00Z (07:00 in Paris), the instant the fixtures are written for. */
export const FIXTURE_NOW = Date.parse('2026-10-13T05:00:00Z');

export const FRONT = '3d6f1a52-8c41-4b7e-9f0a-1c2d3e4f5a60';
export const BACK = '8b2e4c71-5d93-4a1f-b6e8-7f9a0b1c2d30';
export const LAWN = '11a7c3e5-2f4b-4d6c-8e9f-0a1b2c3d4e01';
export const BEDS = '22b8d4f6-3a5c-4e7d-9fa0-1b2c3d4e5f02';
export const HEDGE = '33c9e5a7-4b6d-4f8e-a0b1-2c3d4e5f6a03';
export const VEG = '55ebac39-6d8f-4bae-c2d3-4e5f6a7b8c05';
export const ORCHARD = '66fcbd4a-7e9a-4cbf-d3e4-5f6a7b8c9d06';
export const LAWN_SCHEDULE = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c01';
export const FLEX_SCHEDULE = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c03';

export const json = (body, status = 200, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** A running schedule of `zoneId`, started at `start` for `seconds`. */
export function running(zoneId, start, seconds = 600, deviceId = FRONT) {
  return {
    ...fixture('current-schedule-running.json'),
    deviceId,
    zoneId,
    startDate: start,
    zoneStartDate: start,
    duration: seconds,
    zoneDuration: seconds,
  };
}

/** A handler returning PASS hands the request to the next matching route. */
export const PASS = Symbol('pass');

/**
 * Install a fake fetch. `routes` is a list of [method, RegExp on the path
 * after /1/public/, handler({ path, method, body, headers })]; a handler
 * returns a Response, or a plain value answered as JSON (undefined: 204).
 * `budget` ({ limit, remaining, reset }) adds the rate limit headers and
 * counts the calls down.
 */
export function installFetch(routes, { budget } = {}) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const path = new URL(url).pathname.replace(/^\/1\/public\//, '');
    const call = {
      url,
      path,
      method,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers ?? {},
    };
    calls.push(call);
    let answer = PASS;
    for (const [m, pattern, handler] of routes) {
      if (m === method && pattern.test(path)) {
        answer = await handler(call);
        if (answer !== PASS) {
          break;
        }
      }
    }
    if (answer === PASS) {
      throw new Error(`Unexpected network call in a test: ${method} ${url}`);
    }
    const response =
      answer instanceof Response
        ? answer
        : answer === undefined
          ? json(undefined, 204)
          : json(answer);
    if (!budget) {
      return response;
    }
    budget.remaining = Math.max(0, budget.remaining - 1);
    const headers = new Headers(response.headers);
    headers.set('x-ratelimit-limit', String(budget.limit));
    headers.set('x-ratelimit-remaining', String(budget.remaining));
    if (budget.reset) {
      headers.set('x-ratelimit-reset', budget.reset);
    }
    return new Response(response.status === 204 ? null : await response.text(), {
      status: response.status,
      headers,
    });
  });
  return { calls, restore: () => setFetch(previous) };
}
