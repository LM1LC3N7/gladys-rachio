// -----------------------------------------------------------------------------
// Constants of the Rachio integration.
// -----------------------------------------------------------------------------

/** The Rachio public API v1 (https://rachio.readme.io/reference). */
export const RACHIO_API_URL = 'https://api.rach.io/1/public';

export const USER_AGENT = 'gladys-rachio/0.1 (+https://github.com/LM1LC3N7/gladys-rachio)';
export const HTTP_TIMEOUT = 15_000;

// --- Pacing ---------------------------------------------------------------------
// Rachio allows a daily budget of calls per API key (3,500 in the current
// documentation and the live headers, 1,700 when this module was specified):
// the pacing below keeps a two-controller home far under the lowest of the
// two. See CLAUDE.md.

/** The loop wakes up every minute; most ticks make no call at all. */
export const TICK_INTERVAL = 60_000;
/** The running schedule is re-read at this pace while watering runs or is expected. */
export const WATCH_INTERVAL = 2 * 60_000;
/** A command reaches the controller in a few seconds: read it back after that. */
export const COMMAND_SETTLE = 20_000;
/** After a start command, watch that long for the run to show up, no longer. */
export const EXPECT_WINDOW = 5 * 60_000;
/** Below this many calls left, the loop slows down until the budget resets. */
export const LOW_BUDGET = 100;
/** The account read while the budget is low. */
export const LOW_BUDGET_INTERVAL = 60 * 60_000;
/** A budget spent without a reset date: wait that long before trying again. */
export const RATE_LIMIT_PAUSE = 60 * 60_000;
/** Two refreshes triggered by Rachio webhook events are at least that far apart. */
export const WEBHOOK_COOLDOWN = 60_000;

// --- Limits of the Rachio API ---------------------------------------------------------

/** zone/start accepts 0 to 10,800 seconds (3 hours). */
export const MAX_ZONE_SECONDS = 10_800;
/** device/rain_delay accepts 0 to 604,800 seconds (7 days). */
export const MAX_RAIN_DELAY_HOURS = 168;

/** Manifest keys (forever: stored in user scenes and dashboards). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = {
  WATER_ZONE: 'water_zone',
  WATER_ZONES: 'water_zones',
  RUN_SCHEDULE: 'run_schedule',
  SKIP_SCHEDULE: 'skip_schedule',
  STOP: 'stop_watering',
  RAIN_DELAY: 'set_rain_delay',
};
export const SCENE_TRIGGERS = {
  STARTED: 'watering_started',
  FINISHED: 'watering_finished',
  RAIN_DELAY: 'rain_delay_changed',
  STATUS: 'controller_status_changed',
};
export const WIDGETS = { GARDEN: 'garden' };
export const WEBHOOKS = { EVENTS: 'events' };

/** The actions of the buttons of the "garden" widget (forever: cached contents). */
export const WIDGET_ACTIONS = {
  START: 'start_zone',
  STOP: 'stop',
  SCHEDULE: 'run_schedule',
  RAIN_DELAY: 'rain_delay',
};

/** Values of the `event` field of the rain_delay_changed trigger. */
export const RAIN_DELAY_EVENTS = { SET: 'set', CLEARED: 'cleared' };
/** Values of the `event` field of the controller_status_changed trigger. */
export const STATUS_EVENTS = { ONLINE: 'online', OFFLINE: 'offline' };
