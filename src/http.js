// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout and an
// identifiable User-Agent. The tests replace it with `setFetch()`.
//
// The answer keeps its headers: Rachio reports the remaining daily budget in
// them, on success and on error alike.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class HttpError extends Error {
  constructor(status, url, body, headers) {
    // The path only: never the query string nor a header (the key travels in one).
    super(`HTTP ${status} on ${new URL(url).pathname}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const parse = (text) => {
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * One request. `body` is JSON-encoded. Resolves { status, headers, data }
 * (`data` undefined on an empty body, e.g. a 204); throws an HttpError on a
 * non-2xx status, with the parsed body and the headers.
 */
export async function request(
  url,
  { method = 'GET', headers = {}, body, timeout = HTTP_TIMEOUT } = {},
) {
  const init = {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, timeout)),
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetchImpl(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(response.status, url, parse(text.slice(0, 2000)), response.headers);
  }
  return { status: response.status, headers: response.headers, data: parse(text) };
}
