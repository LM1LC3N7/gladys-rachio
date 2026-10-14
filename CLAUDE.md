# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
reads a **Rachio** account through the public API v1 (`api.rach.io/1/public`,
a personal API key) and exposes the smart sprinkler controllers and their
zones as Gladys devices, with scene triggers, scene actions, a dashboard
widget and optional real-time events through Gladys Plus webhooks.
Unofficial: not affiliated with Rachio.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js              SDK wiring only (handlers registered before connect())
src/app.js            RachioApp: account, discovery, paced loop, commands,
                      scene actions, widget, webhooks, test button
src/rachio/client.js  the API client: Bearer key, endpoints, request bodies,
                      rate limit tracking, RachioError
src/rachio/model.js   Rachio JSON -> controllers / zones / runs / readings (pure)
src/devices.js        the controller and zone devices, feature keys, states (pure)
src/triggers.js       transitions -> scene events (pure)
src/widget.js         the "garden" widget (pure)
src/webhook.js        Gladys Plus webhooks: event types, plan, inbound (pure)
src/config.js         config_schema normalized (DEFAULTS, BOUNDS)
src/constants.js      endpoint, pacing, limits, manifest keys
src/i18n.js           runtime texts (en/fr)
src/http.js           the only network access (fetch, timeout, headers kept)
test/fixtures/        Rachio answers shaped after the public documentation
test/helpers/         fake fetch (routes + rate limit headers), fake timers;
                      Gladys is the SDK's fake
```

## Rules

- **Unofficial.** Every user-facing surface says "unofficial connector, not
  affiliated with Rachio". Never use the Rachio logo.
- **Keys are forever**: the manifest keys and the widget button actions
  (`src/constants.js`), the feature keys (`FEATURE` in `src/devices.js`) and
  the external id shapes (`controller:<rachio device id>`,
  `zone:<rachio zone id>`) are stored in user scenes and dashboards. Never
  rename them.
- **The API key is a secret**: sent only in the `Authorization` header to
  `api.rach.io`, never in a URL, a log line, an error or a status message.
- **Be polite with Rachio: the daily budget.** Rachio counts the calls per
  API key and per day: 3,500 in the current documentation and in the live
  headers (`x-ratelimit-limit: 3500`, `x-ratelimit-reset:
2026-10-15T00:00:00Z`, seen on 2026-10-14 on a 401), 1,700 when this module
  was specified. The headers are the truth; the pacing keeps a
  two-controller home far under 1,700:
  - start: `person/info` + `person/{id}` + one `current_schedule` per online
    controller (`person/info` is skipped on a reconnection with the same
    key); with Gladys Plus, + 1 event type list + 1 webhook list per
    controller (+ an add when missing);
  - every `poll_interval` minutes (default 10, never below 5): `person/{id}`
    (every controller, zone and schedule in one call) + one
    `current_schedule` per online controller;
  - while a controller waters, or after a start command until its run shows
    up (`EXPECT_WINDOW`, 5 minutes at most): its `current_schedule` every 2
    minutes (`WATCH_INTERVAL`), never more;
  - a command: the command + one read back 20 s later (`COMMAND_SETTLE`);
  - a webhook event: `person/{id}` + one `current_schedule`, at most once a
    minute (`WEBHOOK_COOLDOWN`), a burst ends with one trailing refresh.
  - Budget: a quiet day at 10 minutes is 144 × (1 + online controllers)
    calls (288 for one controller, 432 for two), + about 25 per hour of
    watering per controller. At 5 minutes, two controllers: 864 + watering.
  - Below 100 calls left (`LOW_BUDGET`): the account once an hour, no
    schedule read, webhook events ignored. At 0 or on a 429: no call until
    `X-RateLimit-Reset` (an hour without it).
- **One event per transition** (`src/triggers.js`): the first reading fires
  nothing; a zone change in a schedule is "finished" then "started"; a rain
  delay moved by more than 5 minutes is a new "set".
- **Trigger, not data**: a webhook event only says "read this controller
  now"; its payload is never applied as a state. Our webhooks are recognized
  by their `externalId` (`gladys-rachio:` + a hash of the relay URL); the
  others are never touched.
- **Built blind**: no Rachio account was available. Every response field
  name lives in `src/rachio/model.js`, every endpoint and request body in
  `src/rachio/client.js`, so a user report fixes one place. `TODO.md` lists
  what to confirm.
- **Read-only rootfs**: write nothing on disk.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code (keys, defaults, bounds, trigger fields and variables
  against the events the code fires).
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (`installFetch` replaces `fetch`); the
  widget contents pass the SDK's `validateWidgetContent`.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.
- The Docker image cannot be built in the Claude Code cloud container (no
  network for `apk` inside `docker build`): the CI builds it.

## Checking a field against the real API

The documentation is at https://rachio.readme.io/reference (an index for
tools at https://rachio.readme.io/llms.txt). With a key:

```bash
KEY=...   # never commit it
curl -sH "Authorization: Bearer $KEY" https://api.rach.io/1/public/person/info
curl -sH "Authorization: Bearer $KEY" https://api.rach.io/1/public/person/<id> | python3 -m json.tool | less
curl -sH "Authorization: Bearer $KEY" https://api.rach.io/1/public/device/<id>/current_schedule
```

Anonymize an answer (ids, names, serials, addresses, coordinates) before it
becomes a fixture.
