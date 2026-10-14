# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Rachio account (Gen 2 or 3
      controller): the key, discovery, the zone switches, a schedule run, a
      rain delay, the standby switch, the widget and its four buttons, the
      four scene triggers over a watering day.
- [ ] Test the Gladys Plus webhooks end to end: the registration, an event
      relayed and refreshing the controller, the removal when Plus is
      unlinked.
- [ ] Watch the `X-RateLimit-Remaining` header over a day (the "Test
      Rachio" button shows it) to confirm the budget in CLAUDE.md.
- [ ] Reserve "Rachio" in the forum thread t/10385, then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm with a real account (built blind)

- [ ] `person/{id}`: the device fields `status` (`ONLINE` / `OFFLINE`),
      `on`, `deleted`, `timeZone`, `rainDelayExpirationDate` (epoch ms, and
      whether it stays in the past once the delay is over), and the zone
      fields `zoneNumber`, `enabled`, `maxRuntime`, `lastWateredDate`.
- [ ] `lastWateredDuration` on a zone: mentioned by the module brief, absent
      from the documentation examples (the text then shows the date only).
- [ ] `device/{id}/current_schedule`: `{}` when idle; while watering,
      `zoneId`, `startDate`, `duration`, `zoneStartDate`, `zoneDuration`
      (seconds) and whether `zoneNumber` is present; what it answers during a
      cycle-and-soak pause.
- [ ] `zone/start_multiple`: the documented sample sends
      `{ "zones": [{ "id", "duration", "sortOrder" }] }` while the schema
      names the list `zoneRunDurations`; `zones` is used.
- [ ] `schedulerule/start` and `schedulerule/skip` with the id of a **flex**
      schedule (`flexScheduleRules`), as Home Assistant does.
- [ ] `device/off` is the Rachio "standby" mode and `on` reflects it.
- [ ] The notification webhooks: the event type names
      (`DEVICE_STATUS_EVENT`, `ZONE_STATUS_EVENT`, `SCHEDULE_STATUS_EVENT`,
      `RAIN_DELAY_EVENT`, `RAIN_SENSOR_DETECTION_EVENT`, as Home Assistant
      uses them; the documentation example shows `ZONE_ACTION`), the
      `POST notification/webhook` body (`device.id`, `externalId`, `url`,
      `eventTypes: [{ id }]`), and that each event carries `externalId` and
      `deviceId` at the top level.
- [ ] Rachio accepts the Gladys Plus relay URL (HTTPS, a long path) as a
      webhook URL.
- [ ] Two Gladys instances on the same Rachio account would remove each
      other's webhooks (same `gladys-rachio:` prefix): document or add the
      instance to the prefix if it happens.

## Ideas

- The newer webhook service (`cloud-rest.rach.io/webhook/createWebhook`,
  multi-device, HMAC `x-signature`): it needs the request headers, which
  the Gladys Plus relay does not hand to the integration yet.
- Smart Hose Timer: its valves and base stations through the
  `cloud-rest.rach.io` valve API (`valve/listBaseStations`,
  `valve/listValves`, `valve/startWatering`, `valve/stopWatering`,
  `summary/getValveDayViews`), as zone-like devices.
- The next scheduled run per controller (`device/{id}/upcoming_runs`) as a
  feature and in the widget, read once an hour.
- The weather forecast of the controller (`device/{id}/forecast`) and the
  "skipped for rain" events (`WEATHER_INTELLIGENCE_SKIP`).
- Pause and resume a zone run (`device/pause_zone_run`,
  `device/resume_zone_run`), skip to the next zone
  (`schedulerule/skip_forward_zone_run`).
- Seasonal adjustment of a schedule (`schedulerule/seasonal_adjustment`) as
  a scene action.
- A per-zone default duration (device params) once Gladys lets the user edit
  them.
