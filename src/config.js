// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  default_minutes: 10,
  poll_interval: 10,
};

/** Bounds of the number fields (also the manifest's `min` / `max`). */
export const BOUNDS = {
  default_minutes: [1, 180],
  poll_interval: [5, 60],
};

const number = (value, fallback, [min, max]) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' && value !== null
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

export function normalizeConfig(raw = {}) {
  return {
    // A key pasted with spaces or quotes around it is still the key.
    apiKey: typeof raw.api_key === 'string' ? raw.api_key.trim().replace(/^["']|["']$/g, '') : '',
    defaultMinutes: number(raw.default_minutes, DEFAULTS.default_minutes, BOUNDS.default_minutes),
    pollMinutes: number(raw.poll_interval, DEFAULTS.poll_interval, BOUNDS.poll_interval),
  };
}
