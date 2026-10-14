// -----------------------------------------------------------------------------
// The "garden" dashboard widget: one controller, its state, its zones, and
// buttons to water a zone, stop, run a schedule or set a rain delay. Pure.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MAX_RAIN_DELAY_HOURS, WIDGET_ACTIONS } from './constants.js';
import { BOUNDS } from './config.js';
import { T } from './i18n.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
/** A runtime name as the multi-language label a form option needs. */
const label = (name) => ({ en: String(name).slice(0, 40), fr: String(name).slice(0, 40) });

/** "13/10 06:12" (fr) or "13 Oct, 06:12" (en) in the controller's time zone. */
export function shortTime(iso, timeZone, language = 'en') {
  const date = new Date(iso);
  const options = {
    day: '2-digit',
    month: language === 'fr' ? '2-digit' : 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  try {
    return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
      ...options,
      timeZone: timeZone ?? undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).format(date);
  }
}

function stateRow(controller, reading, language) {
  const row = { label: T.widget.state, icon: 'cpu' };
  if (!reading.online) {
    return { ...row, value: pick(T.widget.offline, language), color: WIDGET_COLORS.DANGER };
  }
  if (reading.run) {
    return {
      ...row,
      value: `${pick(T.widget.watering, language)} · ${reading.run.zoneName}`.slice(0, 40),
      icon: 'droplet',
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  if (reading.rainDelayUntil) {
    return {
      ...row,
      value: pick(
        T.widget.rainDelayUntil(shortTime(reading.rainDelayUntil, controller.timeZone, language)),
        language,
      ).slice(0, 40),
      icon: 'cloud-rain',
      color: WIDGET_COLORS.INFO,
    };
  }
  if (!reading.on) {
    return { ...row, value: pick(T.widget.standby, language), color: WIDGET_COLORS.WARNING };
  }
  return { ...row, value: pick(T.widget.idle, language), color: WIDGET_COLORS.NEUTRAL };
}

function zoneRow(controller, zone, reading, language) {
  const watering = reading.run?.zoneId === zone.id;
  let value;
  if (watering) {
    value = pick(T.widget.wateringLeft(reading.run.zoneRemainingMinutes), language);
  } else if (zone.lastWateredAt) {
    value = pick(
      T.widget.last(shortTime(zone.lastWateredAt, controller.timeZone, language)),
      language,
    );
  } else {
    value = pick(T.widget.never, language);
  }
  return {
    label: zone.name.slice(0, 40),
    value: value.slice(0, 40),
    icon: 'droplet',
    color: watering ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
  };
}

/**
 * `controller` is the model's controller, `reading` its readingOf(); the
 * buttons carry the Rachio controller id in their params.
 */
export function gardenWidget({ controller, reading, defaultMinutes = 10, language = 'en' }) {
  if (!controller || !reading) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', text: T.widget.noController, variant: 'body' }],
    };
  }
  const zones = controller.zones.filter((z) => z.enabled);
  const components = [
    { type: 'text', text: controller.name.slice(0, 40), variant: 'heading' },
    {
      type: 'value',
      label: T.widget.left,
      value: reading.run ? reading.run.remainingMinutes : 0,
      unit: 'min',
      icon: 'clock',
      color: reading.run ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: T.widget.rainDelay,
      value: reading.rainDelayHours,
      unit: 'h',
      icon: 'cloud-rain',
      color: reading.rainDelayHours > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
  ];

  // One status list: the controller first, then the zones (10 rows at most).
  const rows = [stateRow(controller, reading, language)];
  const room = zones.length > 9 ? 8 : 9;
  for (const zone of zones.slice(0, room)) {
    rows.push(zoneRow(controller, zone, reading, language));
  }
  if (zones.length > room) {
    rows.push({
      label: T.widget.otherZones,
      value: pick(T.widget.more(zones.length - room), language),
      icon: 'more-horizontal',
    });
  }
  components.push({ type: 'status', items: rows });

  const params = { controller: controller.id };
  if (zones.length > 0) {
    const current = zones.find((z) => z.id === reading.run?.zoneId) ?? zones[0];
    components.push({
      type: 'button',
      label: T.widget.water,
      icon: 'droplet',
      style: 'primary',
      action: {
        key: WIDGET_ACTIONS.START,
        params,
        fields: [
          {
            key: 'zone',
            type: 'select',
            required: true,
            label: T.widget.zone,
            options: zones.map((z) => ({ value: z.id, label: label(z.name) })),
            default: current.id,
          },
          {
            key: 'minutes',
            type: 'number',
            required: true,
            label: T.widget.minutes,
            min: BOUNDS.default_minutes[0],
            max: BOUNDS.default_minutes[1],
            default: defaultMinutes,
          },
        ],
      },
    });
  }
  if (reading.run) {
    components.push({
      type: 'button',
      label: T.widget.stop,
      icon: 'square',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.STOP, params },
    });
  }
  const schedules = controller.schedules.filter((s) => s.enabled);
  if (schedules.length > 0) {
    components.push({
      type: 'button',
      label: T.widget.schedule,
      icon: 'calendar',
      style: 'secondary',
      action: {
        key: WIDGET_ACTIONS.SCHEDULE,
        params,
        confirm: false,
        fields: [
          {
            key: 'schedule',
            type: 'select',
            required: true,
            label: T.widget.scheduleField,
            options: schedules.map((s) => ({ value: s.id, label: label(s.name) })),
            default: schedules[0].id,
          },
        ],
      },
    });
  }
  components.push({
    type: 'button',
    label: T.widget.rainDelay,
    icon: 'cloud-rain',
    style: 'secondary',
    action: {
      key: WIDGET_ACTIONS.RAIN_DELAY,
      params,
      fields: [
        {
          key: 'hours',
          type: 'number',
          required: true,
          label: T.widget.hours,
          min: 0,
          max: MAX_RAIN_DELAY_HOURS,
          // A delay running: the form offers to cancel it; none: one day.
          default: reading.rainDelayHours > 0 ? 0 : 24,
        },
      ],
    },
  });
  return { ttl_seconds: reading.run ? 60 : 300, components };
}
