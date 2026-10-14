// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the RachioApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { RachioApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WEBHOOKS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new RachioApp({ gladys });

// --- Discovery and commands ------------------------------------------------------
gladys.onScanRequest(() => app.scan());
gladys.onDeviceCreated(() => app.deviceCreated());
gladys.onDeviceUpdated(() => app.deviceCreated());
gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

// --- Scene actions --------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.WATER_ZONE, (fields) => app.waterZone(fields));
gladys.onSceneAction(SCENE_ACTIONS.WATER_ZONES, (fields) => app.waterZones(fields));
gladys.onSceneAction(SCENE_ACTIONS.RUN_SCHEDULE, (fields) => app.runSchedule(fields));
gladys.onSceneAction(SCENE_ACTIONS.SKIP_SCHEDULE, (fields) => app.skipSchedule(fields));
gladys.onSceneAction(SCENE_ACTIONS.STOP, (fields) => app.stopWatering(fields));
gladys.onSceneAction(SCENE_ACTIONS.RAIN_DELAY, (fields) => app.setRainDelay(fields));

// --- Dashboard widget ----------------------------------------------------------
gladys.onWidgetGet(WIDGETS.GARDEN, (request) => app.getWidget(request));
gladys.onWidgetAction(WIDGETS.GARDEN, (actionKey, params, context) =>
  app.widgetAction(actionKey, params, context),
);

// --- Real-time events relayed by Gladys Plus (optional) ---------------------------
gladys.onWebhook(WEBHOOKS.EVENTS, (request) => app.handleWebhook(request));
gladys.onWebhookUpdated((info) => app.webhookUpdated(info));

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Rachio integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
