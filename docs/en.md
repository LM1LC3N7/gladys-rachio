# Rachio

**Unofficial connector, not affiliated with Rachio.** It brings your Rachio
smart sprinkler controllers into Gladys through the public Rachio API: the
zones, the watering in progress, the rain delay and the schedules. Rachio is
a trademark of Rachio, Inc.

## What you get

| Surface                         | Content                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per **controller**   | online, **On** switch (off: standby, the schedules stop), watering now, the zone watering now, the minutes left, the hours of rain delay left                 |
| One device per **enabled zone** | a **Watering** switch (on: waters for the default time, off: stops the controller), the last watering ("2026-10-12 06:00 · 15 min", in the controller's time) |
| Scene triggers                  | **watering started**, **watering finished** (any zone or one zone), **rain delay set or cleared**, **controller offline or online**                           |
| Scene actions                   | **water a zone**, **water several zones**, **run a schedule**, **skip a schedule**, **stop watering**, **set a rain delay** (0 cancels it)                    |
| Dashboard widget                | **Rachio garden**: a controller, its zones and their last watering, buttons to water a zone, stop, run a schedule and set a rain delay                        |

## Setup

1. Get your API key: in the Rachio app, open **Profile**, then **API key** and
   **Copy**; or on [app.rach.io](https://app.rach.io/), **Account settings**,
   then **Get API key**.
2. Install the integration, paste the key in **API key** and save. The status
   says "Connected to Rachio" with the number of controllers and zones.
3. Open **Discovery** and add the controllers and the zones you want.
   Disabled zones are not offered.
4. Put the **Rachio garden** widget on a dashboard (pick a controller, or
   leave it empty for the first one).

The **Test Rachio** button lists the controllers, the zones, the **names of
the schedules** (the scene actions use them) and the API calls left today.

## Scenes

- **Watering started** / **Watering finished**: leave the controller and the
  zone empty for any zone, or pick one. Variables: the zone name and number,
  the planned duration (started), the minutes watered (finished). A watering
  started from Gladys counts too. When a schedule moves to the next zone, the
  previous zone finishes and the next one starts.
- **Rain delay set or cleared**: set also fires when the delay is extended;
  cleared fires when it is canceled or simply over. Variables: the end date
  and the hours left.
- **Controller offline or online**: the controller lost its Wi-Fi, or came
  back.
- **Water a zone** (minutes optional), **water several zones** (one after the
  other, in zone order, the same minutes each), **run a schedule** and **skip
  a schedule** (by name, as in the Rachio app), **stop watering** (one
  controller, or every online one), **set a rain delay** (hours, 0 cancels).

A zone runs 1 to 180 minutes (3 hours, Rachio's limit), a rain delay up to
168 hours (7 days). Stopping a zone stops the whole controller: that is how
Rachio works.

## How fresh is it

Rachio allows a limited number of API calls a day per key. The integration
reads the account every **10 minutes** (option **Refresh interval**, 5 to 60)
and follows a running watering **every 2 minutes**, so a watering started by
a Rachio schedule or the app is seen within the refresh interval. After a
command from Gladys, the controller is read back 20 seconds later.

With **Gladys Plus**, paste your Open API key in the "Gladys Plus webhooks"
block of the configuration: the integration registers a Rachio webhook and
each Rachio event (zone started, rain delay, offline…) triggers a read at
once. The regular reading goes on: it stays the reference.

If fewer than 100 calls are left for the day, the integration reads once an
hour until Rachio resets the counter; if none is left, it waits for the reset
and says so in the status.

## Troubleshooting

- **"Rachio refused the API key"**: copy the key again from the Rachio app
  and save; the integration stops reading until the key changes.
- **A zone is missing**: it is disabled in the Rachio app; enable it, then
  run Discovery again.
- **A schedule is not found**: use the **Test Rachio** button to see the
  exact names.
- **A short watering was not seen**: without Gladys Plus, a watering shorter
  than the refresh interval can start and end between two readings.
- Logs: the integration's log level is set with the `LOG_LEVEL` variable.

## Privacy

The API key is stored encrypted by Gladys and only sent to `api.rach.io`. The
integration sends Rachio nothing else than the commands you give and the
Gladys Plus relay address when webhooks are on.
