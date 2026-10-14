// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, action results, widget).
// -----------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "14:00 UTC" for a reset date, or nothing without one. */
const utc = (iso) => (iso ? `${new Date(iso).toISOString().slice(11, 16)} UTC` : '');

export const T = {
  noKey: {
    en: 'No API key: paste your Rachio API key in the configuration (Rachio app → Profile → API key).',
    fr: "Pas de clé d'API : collez votre clé d'API Rachio dans la configuration (application Rachio → Profil → API key).",
  },
  unauthorized: {
    en: 'Rachio refused the API key: copy it again from the Rachio app (Profile → API key) and save.',
    fr: "Rachio a refusé la clé d'API : copiez-la à nouveau depuis l'application Rachio (Profil → API key) et enregistrez.",
  },
  ok: ({ controllers, zones, realtime }) => ({
    en: `Connected to Rachio: ${plural(controllers, 'controller')}, ${plural(zones, 'zone')}${realtime ? ', real-time events through Gladys Plus' : ''}.`,
    fr: `Connecté à Rachio : ${controllers} contrôleur${controllers > 1 ? 's' : ''}, ${zones} zone${zones > 1 ? 's' : ''}${realtime ? ', événements en temps réel via Gladys Plus' : ''}.`,
  }),
  noController: {
    en: 'Connected to Rachio, but the account has no controller.',
    fr: "Connecté à Rachio, mais le compte n'a aucun contrôleur.",
  },
  lowBudget: (resetAt) => ({
    en: `Rachio API budget almost spent: reading slowed down until the daily reset${resetAt ? ` (${utc(resetAt)})` : ''}.`,
    fr: `Budget d'appels Rachio presque épuisé : lecture ralentie jusqu'à la remise à zéro quotidienne${resetAt ? ` (${utc(resetAt)})` : ''}.`,
  }),
  rateLimited: (resetAt) => ({
    en: `Rachio daily API limit reached: reading paused until ${resetAt ? utc(resetAt) : 'the next hour'}.`,
    fr: `Limite quotidienne de l'API Rachio atteinte : lecture suspendue jusqu'à ${resetAt ? utc(resetAt) : "l'heure suivante"}.`,
  }),
  unreachable: (message) => ({
    en: `Rachio is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Rachio est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  test: ({ controllers, rateLimit, realtime }) => {
    const en = [];
    const fr = [];
    if (controllers.length === 0) {
      en.push('Rachio answers, but the account has no controller.');
      fr.push("Rachio répond, mais le compte n'a aucun contrôleur.");
    }
    for (const c of controllers) {
      const zones = c.zones.filter((z) => z.enabled).length;
      const schedules = c.schedules.map((s) => s.name).join(', ');
      en.push(
        `${c.name}: ${c.online ? 'online' : 'OFFLINE'}${c.on ? '' : ', standby'}, ${plural(zones, 'zone')}${schedules ? `, schedules: ${schedules}` : ', no schedule'}.`,
      );
      fr.push(
        `${c.name} : ${c.online ? 'en ligne' : 'HORS LIGNE'}${c.on ? '' : ', en veille'}, ${zones} zone${zones > 1 ? 's' : ''}${schedules ? `, programmes : ${schedules}` : ', aucun programme'}.`,
      );
    }
    if (rateLimit?.remaining !== null && rateLimit?.remaining !== undefined) {
      en.push(
        `API budget: ${rateLimit.remaining}${rateLimit.limit ? ` of ${rateLimit.limit}` : ''} calls left today.`,
      );
      fr.push(
        `Budget d'API : ${rateLimit.remaining}${rateLimit.limit ? ` sur ${rateLimit.limit}` : ''} appels restants aujourd'hui.`,
      );
    }
    en.push(
      realtime
        ? 'Real-time events: Rachio webhooks registered through Gladys Plus.'
        : 'Real-time events: none (no Gladys Plus webhook), polling only.',
    );
    fr.push(
      realtime
        ? 'Événements en temps réel : webhooks Rachio enregistrés via Gladys Plus.'
        : 'Événements en temps réel : aucun (pas de webhook Gladys Plus), lecture périodique seulement.',
    );
    return { en: en.join('\n'), fr: fr.join('\n') };
  },
  unknownZone: (value) => ({
    en: `Unknown Rachio zone "${value}": pick a zone device.`,
    fr: `Zone Rachio inconnue « ${value} » : choisissez un appareil zone.`,
  }),
  unknownController: (value) => ({
    en: `Unknown Rachio controller "${value}".`,
    fr: `Contrôleur Rachio inconnu « ${value} ».`,
  }),
  unknownSchedule: (value) => ({
    en: `Unknown Rachio schedule "${value}": the "Test Rachio" button lists them.`,
    fr: `Programme Rachio inconnu « ${value} » : le bouton « Tester Rachio » les liste.`,
  }),
  widget: {
    noController: {
      en: 'No Rachio controller yet: check the API key in the configuration.',
      fr: "Aucun contrôleur Rachio : vérifiez la clé d'API dans la configuration.",
    },
    watering: { en: 'Watering', fr: 'Arrosage' },
    idle: { en: 'Idle', fr: 'Au repos' },
    standby: { en: 'Standby', fr: 'En veille' },
    offline: { en: 'Offline', fr: 'Hors ligne' },
    state: { en: 'Controller', fr: 'Contrôleur' },
    left: { en: 'Time left', fr: 'Restant' },
    rainDelay: { en: 'Rain delay', fr: 'Délai pluie' },
    rainDelayUntil: (text) => ({ en: `Rain delay → ${text}`, fr: `Délai pluie → ${text}` }),
    wateringLeft: (m) => ({ en: `watering · ${m} min left`, fr: `arrosage · ${m} min restantes` }),
    last: (text) => ({ en: `last ${text}`, fr: `dernier ${text}` }),
    never: { en: 'never watered', fr: 'jamais arrosée' },
    more: (n) => ({ en: `${n} more`, fr: `${n} de plus` }),
    otherZones: { en: 'Other zones', fr: 'Autres zones' },
    water: { en: 'Water a zone', fr: 'Arroser une zone' },
    stop: { en: 'Stop watering', fr: "Arrêter l'arrosage" },
    schedule: { en: 'Run a schedule', fr: 'Lancer un programme' },
    zone: { en: 'Zone', fr: 'Zone' },
    minutes: { en: 'Minutes', fr: 'Minutes' },
    hours: { en: 'Hours (0 cancels)', fr: 'Heures (0 annule)' },
    scheduleField: { en: 'Schedule', fr: 'Programme' },
    started: (zone, m) => ({
      en: `${zone}: watering for ${m} min`,
      fr: `${zone} : arrosage pendant ${m} min`,
    }),
    scheduleStarted: (name) => ({ en: `${name} started`, fr: `${name} lancé` }),
    stopped: { en: 'Watering stopped', fr: 'Arrosage arrêté' },
    rainDelaySet: (h) =>
      h > 0
        ? { en: `Rain delay: ${h} h`, fr: `Délai pluie : ${h} h` }
        : { en: 'Rain delay canceled', fr: 'Délai pluie annulé' },
    needsForm: {
      en: 'Update Gladys to use this button (it needs a form).',
      fr: 'Mettez Gladys à jour pour utiliser ce bouton (il demande un formulaire).',
    },
    failed: (message) => ({
      en: `Rachio refused: ${message}`.slice(0, 200),
      fr: `Rachio a refusé : ${message}`.slice(0, 200),
    }),
  },
};
