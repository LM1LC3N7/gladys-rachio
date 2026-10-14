// -----------------------------------------------------------------------------
// The Rachio public API v1 client (https://api.rach.io/1/public), as raw
// JSON: turning it into values is model.js's job.
//
// Authentication: "Authorization: Bearer <API key>". The key never appears in
// a URL, a log line or an error message.
//
// Every answer, error included, carries the daily budget of the key in its
// X-RateLimit-* headers: the client keeps the latest in `rateLimit` so the
// app can slow down before Rachio refuses (429).
// -----------------------------------------------------------------------------

import { RACHIO_API_URL } from '../constants.js';
import { HttpError, request } from '../http.js';
import { errorMessageOf, rateLimitOf } from './model.js';

export class RachioError extends Error {
  /** `code`: no_key | unauthorized | rate_limited | http | timeout | network. */
  constructor(code, message, status) {
    super(message);
    this.name = 'RachioError';
    this.code = code;
    this.status = status;
  }
}

export class RachioClient {
  constructor({ apiKey = '', baseUrl = RACHIO_API_URL } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    /** { limit, remaining, resetAt } from the last answer, or undefined. */
    this.rateLimit = undefined;
    /** Calls made by this client (the tests and the budget log use it). */
    this.calls = 0;
  }

  track(headers) {
    const rateLimit = rateLimitOf(headers);
    if (rateLimit) {
      this.rateLimit = rateLimit;
    }
  }

  async call(path, { method = 'GET', body } = {}) {
    if (!this.apiKey) {
      throw new RachioError('no_key', 'No Rachio API key configured');
    }
    this.calls += 1;
    try {
      const answer = await request(`${this.baseUrl}/${path}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      this.track(answer.headers);
      return answer.data;
    } catch (err) {
      if (err instanceof HttpError) {
        this.track(err.headers);
        if (err.status === 401) {
          throw new RachioError('unauthorized', 'Rachio refused the API key', 401);
        }
        if (err.status === 429) {
          throw new RachioError('rate_limited', 'Rachio daily API limit reached', 429);
        }
        const detail = errorMessageOf(err.body);
        throw new RachioError(
          'http',
          detail ? `${err.message}: ${detail}` : err.message,
          err.status,
        );
      }
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new RachioError(
        timeout ? 'timeout' : 'network',
        timeout ? 'Rachio did not answer in time' : `network error (${err?.message ?? err})`,
      );
    }
  }

  // --- Account -------------------------------------------------------------------------

  /** { id }: the person the key belongs to. */
  personInfo() {
    return this.call('person/info');
  }

  /** The person with every controller, zone and schedule. */
  person(personId) {
    return this.call(`person/${encodeURIComponent(personId)}`);
  }

  /** The run in progress on a controller, `{}` when idle. */
  currentSchedule(deviceId) {
    return this.call(`device/${encodeURIComponent(deviceId)}/current_schedule`);
  }

  // --- Commands (204 No Content) -----------------------------------------------------------

  startZone(zoneId, seconds) {
    return this.call('zone/start', { method: 'PUT', body: { id: zoneId, duration: seconds } });
  }

  /** `zones`: [{ id, seconds }] in watering order. */
  startZones(zones) {
    return this.call('zone/start_multiple', {
      method: 'PUT',
      body: {
        zones: zones.map((z, index) => ({ id: z.id, duration: z.seconds, sortOrder: index })),
      },
    });
  }

  stopWater(deviceId) {
    return this.call('device/stop_water', { method: 'PUT', body: { id: deviceId } });
  }

  /** 0 cancels the rain delay. */
  rainDelay(deviceId, seconds) {
    return this.call('device/rain_delay', {
      method: 'PUT',
      body: { id: deviceId, duration: seconds },
    });
  }

  /** On: schedules and weather intelligence run; off: standby. */
  setOn(deviceId, on) {
    return this.call(on ? 'device/on' : 'device/off', { method: 'PUT', body: { id: deviceId } });
  }

  startSchedule(scheduleId) {
    return this.call('schedulerule/start', { method: 'PUT', body: { id: scheduleId } });
  }

  skipSchedule(scheduleId) {
    return this.call('schedulerule/skip', { method: 'PUT', body: { id: scheduleId } });
  }

  // --- Notification webhooks (the Gladys Plus relay) ------------------------------------------

  webhookEventTypes() {
    return this.call('notification/webhook_event_type');
  }

  deviceWebhooks(deviceId) {
    return this.call(`notification/${encodeURIComponent(deviceId)}/webhook`);
  }

  addWebhook({ deviceId, externalId, url, eventTypeIds }) {
    return this.call('notification/webhook', {
      method: 'POST',
      body: {
        device: { id: deviceId },
        externalId,
        url,
        eventTypes: eventTypeIds.map((id) => ({ id })),
      },
    });
  }

  deleteWebhook(webhookId) {
    return this.call(`notification/webhook/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    });
  }
}
