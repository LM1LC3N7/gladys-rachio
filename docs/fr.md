# Rachio

**Connecteur non officiel, sans lien avec Rachio.** Il amène vos
contrôleurs d'arrosage connectés Rachio dans Gladys via l'API publique
Rachio : les zones, l'arrosage en cours, le délai pluie et les programmes.
Rachio est une marque de Rachio, Inc.

## Ce que vous obtenez

| Surface                         | Contenu                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **contrôleur**  | en ligne, interrupteur **On** (éteint : veille, les programmes s'arrêtent), arrosage en cours, zone en cours, minutes restantes, heures de délai pluie restantes                    |
| Un appareil par **zone active** | un interrupteur **Watering** (allumé : arrose pendant la durée par défaut, éteint : arrête le contrôleur), le dernier arrosage (« 2026-10-12 06:00 · 15 min », heure du contrôleur) |
| Déclencheurs de scène           | **arrosage commencé**, **arrosage terminé** (toute zone ou une zone), **délai pluie posé ou levé**, **contrôleur hors ligne ou en ligne**                                           |
| Actions de scène                | **arroser une zone**, **arroser plusieurs zones**, **lancer un programme**, **sauter un programme**, **arrêter l'arrosage**, **poser un délai pluie** (0 l'annule)                  |
| Widget                          | **Jardin Rachio** : un contrôleur, ses zones et leur dernier arrosage, des boutons pour arroser une zone, arrêter, lancer un programme et poser un délai pluie                      |

## Installation

1. Récupérez votre clé d'API : dans l'application Rachio, ouvrez **Profil**,
   puis **API key** et **Copy** ; ou sur [app.rach.io](https://app.rach.io/),
   **Account settings**, puis **Get API key**.
2. Installez l'intégration, collez la clé dans **Clé d'API** et enregistrez.
   Le statut indique « Connecté à Rachio » avec le nombre de contrôleurs et de
   zones.
3. Ouvrez **Découverte** et ajoutez les contrôleurs et les zones voulus. Les
   zones désactivées ne sont pas proposées.
4. Placez le widget **Jardin Rachio** sur un tableau de bord (choisissez un
   contrôleur, ou laissez vide pour le premier).

Le bouton **Tester Rachio** liste les contrôleurs, les zones, les **noms des
programmes** (les actions de scène les utilisent) et les appels d'API restants
aujourd'hui.

## Scènes

- **Arrosage commencé** / **Arrosage terminé** : laissez le contrôleur et la
  zone vides pour toute zone, ou choisissez-en une. Variables : le nom et le
  numéro de la zone, la durée prévue (commencé), les minutes arrosées
  (terminé). Un arrosage lancé depuis Gladys compte aussi. Quand un programme
  passe à la zone suivante, la zone précédente se termine et la suivante
  commence.
- **Délai pluie posé ou levé** : posé se déclenche aussi quand le délai est
  prolongé ; levé quand il est annulé ou simplement écoulé. Variables : la
  date de fin et les heures restantes.
- **Contrôleur hors ligne ou en ligne** : le contrôleur a perdu son Wi-Fi, ou
  l'a retrouvé.
- **Arroser une zone** (minutes facultatives), **arroser plusieurs zones**
  (l'une après l'autre, dans l'ordre des zones, les mêmes minutes chacune),
  **lancer un programme** et **sauter un programme** (par son nom, comme dans
  l'application Rachio), **arrêter l'arrosage** (un contrôleur, ou tous ceux
  en ligne), **poser un délai pluie** (en heures, 0 l'annule).

Une zone arrose de 1 à 180 minutes (3 heures, la limite de Rachio), un délai
pluie dure jusqu'à 168 heures (7 jours). Arrêter une zone arrête tout le
contrôleur : c'est le fonctionnement de Rachio.

## Fraîcheur des données

Rachio limite le nombre d'appels d'API par jour et par clé. L'intégration lit
le compte toutes les **10 minutes** (option **Intervalle de
rafraîchissement**, 5 à 60) et suit un arrosage en cours **toutes les 2
minutes** : un arrosage lancé par un programme Rachio ou l'application est vu
dans l'intervalle de rafraîchissement. Après une commande depuis Gladys, le
contrôleur est relu 20 secondes plus tard.

Avec **Gladys Plus**, collez votre clé Open API dans le bloc « Webhooks
Gladys Plus » de la configuration : l'intégration enregistre un webhook
Rachio et chaque événement Rachio (zone lancée, délai pluie, hors ligne…)
déclenche aussitôt une lecture. La lecture régulière continue : elle reste la
référence.

S'il reste moins de 100 appels pour la journée, l'intégration ne lit plus
qu'une fois par heure jusqu'à la remise à zéro du compteur par Rachio ; s'il
n'en reste aucun, elle attend la remise à zéro et l'indique dans le statut.

## Dépannage

- **« Rachio a refusé la clé d'API »** : copiez à nouveau la clé depuis
  l'application Rachio et enregistrez ; l'intégration cesse de lire jusqu'au
  changement de clé.
- **Une zone manque** : elle est désactivée dans l'application Rachio ;
  activez-la, puis relancez la Découverte.
- **Un programme est introuvable** : le bouton **Tester Rachio** donne les
  noms exacts.
- **Un arrosage court n'a pas été vu** : sans Gladys Plus, un arrosage plus
  court que l'intervalle de rafraîchissement peut commencer et finir entre
  deux lectures.
- Journaux : le niveau de journalisation se règle avec la variable
  `LOG_LEVEL`.

## Confidentialité

La clé d'API est stockée chiffrée par Gladys et envoyée uniquement à
`api.rach.io`. L'intégration n'envoie à Rachio que les commandes que vous
donnez et l'adresse du relais Gladys Plus quand les webhooks sont actifs.
