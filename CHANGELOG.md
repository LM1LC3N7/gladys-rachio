# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per Rachio controller: online, on / standby switch, watering
  now, the zone watering now, the minutes left and the hours of rain delay
  left.
- One device per enabled zone: a watering switch (on waters for the default
  time, off stops the controller) and the last watering.
- Scene triggers "watering started", "watering finished", "rain delay set
  or cleared" and "controller offline or online".
- Scene actions "water a zone", "water several zones", "run a schedule",
  "skip a schedule", "stop watering" and "set a rain delay".
- The "Rachio garden" dashboard widget: a controller, its zones and their
  last watering, with buttons to water a zone, stop, run a schedule and set
  a rain delay.
- Real-time events through Gladys Plus webhooks (optional): a Rachio event
  triggers an immediate read.
- Reading paced for Rachio's daily API budget: the account every 10 minutes
  (configurable), a running watering every 2 minutes, slower below 100
  calls left and paused until the daily reset when the budget is spent.
- "Test Rachio" button: the controllers, zones, schedule names and API calls
  left today.
