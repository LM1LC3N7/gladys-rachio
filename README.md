# gladys-rachio

[Gladys Assistant](https://gladysassistant.com) external integration for
**Rachio smart sprinkler controllers**, through the
[Rachio public API](https://rachio.readme.io/reference): zones, watering,
rain delay, schedules, scene triggers and actions, a dashboard widget.
**Unofficial, not affiliated with Rachio.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (RachioApp)
                 ├─ src/rachio/client.js  api.rach.io/1/public (Bearer API key), rate limit headers
                 ├─ src/rachio/model.js   person / current schedule -> controllers, zones, runs (pure)
                 ├─ src/devices.js        controller and zone devices, states (pure)
                 ├─ src/triggers.js       two readings -> scene events (pure)
                 ├─ src/widget.js         the "garden" widget (pure)
                 └─ src/webhook.js        Gladys Plus webhooks: plan, inbound check (pure)
```

- **Discovery** offers every controller (`controller:<id>`) and each of its
  enabled zones (`zone:<id>`).
- **Reading**: the account (`person/{id}`, every controller, zone and
  schedule in one call) every `poll_interval` minutes, with the running
  schedule of each online controller; a watering in progress is followed
  every 2 minutes. A loop tick every minute decides, most ticks make no
  call. The `X-RateLimit-*` headers slow the loop down below 100 calls left
  and pause it at 0, until the daily reset.
- **Commands** (zone switch, standby switch, scene actions, widget buttons)
  are read back 20 seconds later.
- **Triggers** come from two consecutive readings of a controller: the
  first reading fires nothing, every transition fires once.
- **Gladys Plus** (optional): a Rachio webhook per controller, recognized by
  its `externalId`; an event only triggers a read ("trigger, not data").

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npx github:GladysAssistant/integration-store .  # store admission checks
```

The fixtures in `test/fixtures/` are shaped after the examples of the public
documentation (the module was built without a Rachio account): see
[TODO.md](TODO.md) for what remains to confirm.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
