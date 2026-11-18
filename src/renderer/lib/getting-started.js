// src/renderer/lib/getting-started.js: the model behind Home's getting-started
// layout (#1493): which plug-ins step 1 offers, which of the three steps are
// done, and whether the layout shows at all.
//
// Pure: app.js and Home pass in what they already know. Loads under plain
// Node (no window at module scope).
//
// Step 1's tiles come from the plug-in registry, never a list of names:
//   - a plug-in "plays here" when it resolves tracks and plays them in the
//     app (capabilities.stream, or capabilities.embedPlayer). YouTube, whose
//     playback opens browser windows, has neither, so it never appears;
//   - it "needs an account" when its manifest says so (settings.requiresAuth,
//     or an authType other than 'none', such as Amazon Music's web session).
// The plays-here plug-ins that need no account (Bandcamp today) are the ones
// a new profile can already play from; the host's own music folder (the
// Local Files plug-in and its watch folders) is shown as its own tile.

const LOCAL_FILES_ID = 'localfiles';

const caps = (r) => (r && r.capabilities) || {};
const setting = (r, key) => (r && r[key] !== undefined ? r[key] : r && r.settings ? r.settings[key] : undefined);

function playsHere(resolver) {
  const c = caps(resolver);
  return !!(c.resolve && (c.stream || c.embedPlayer));
}

function needsAccount(resolver) {
  if (setting(resolver, 'requiresAuth') === true) return true;
  const type = setting(resolver, 'authType');
  return typeof type === 'string' && type !== '' && type !== 'none';
}

// { services, free, folder }: services that need signing in, the no-account
// plug-ins that play here, and the music-folder plug-in (or null).
function stepOnePlugins(loadedResolvers) {
  const list = Array.isArray(loadedResolvers) ? loadedResolvers.filter(playsHere) : [];
  return {
    services: list.filter((r) => r.id !== LOCAL_FILES_ID && needsAccount(r)),
    free: list.filter((r) => r.id !== LOCAL_FILES_ID && !needsAccount(r)),
    folder: list.find((r) => r.id === LOCAL_FILES_ID) || null,
  };
}

// A service tile's state: 'connected' (signed in and allowed to play),
// 'limited' (signed in, but the plan can't play here: the limit's label),
// or 'connect'. `accounts` maps a plug-in id to whether the host knows it is
// signed in; a plug-in the host has no sign-in state for counts as connected
// once it is on and playing (playbackResolvers).
// The first setting a plug-in's manifest marks required (Spotify's Client
// ID), or null.
function requiredSetting(resolver) {
  const fields = (resolver && (resolver.configurable || (resolver.settings && resolver.settings.configurable))) || {};
  const key = Object.keys(fields).find((k) => fields[k] && fields[k].required);
  return key ? { key, label: fields[key].label || key } : null;
}

// A plug-in whose settings panel needs values (Subsonic's server, username
// and password: its manifest's fields that are neither advanced nor given a
// default) and has none saved yet (`saved`, its meta_service_configs entry).
// A field with a default (Apple Music's storefront, its optional token) is
// filled already; a plug-in with no such fields needs none.
function settingsMissing(resolver, saved) {
  const fields = (resolver && (resolver.configurable || (resolver.settings && resolver.settings.configurable))) || {};
  const keys = Object.keys(fields).filter((k) => fields[k] && !fields[k].advanced && !('default' in fields[k]));
  if (keys.length === 0) return false;
  return !keys.some((k) => saved && saved[k] !== undefined && saved[k] !== null && String(saved[k]).trim() !== '');
}

// Whether a plug-in the host has no sign-in for still needs setting up. A
// plug-in that answers isConfigured(config) itself (Plex: signed in, with a
// library picked) decides, as on Plug-Ins (settings-page.js); otherwise its
// settings fields do (settingsMissing).
function setupMissing(resolver, saved) {
  if (resolver && typeof resolver.isConfigured === 'function') {
    try { return !resolver.isConfigured(saved || {}); } catch (e) { return false; }
  }
  return settingsMissing(resolver, saved);
}

// `setupNeeded` maps a plug-in id to true while a required setting isn't
// saved yet (the host knows: Spotify's own Client ID): its tile is 'setup',
// and Connect opens its panel to fill it in.
function serviceState(resolver, { accounts = {}, setupNeeded = {}, playbackResolvers = [], playbackLimits = {} } = {}) {
  const id = resolver && resolver.id;
  const limit = playbackLimits && playbackLimits[id];
  const known = Object.prototype.hasOwnProperty.call(accounts || {}, id);
  const signedIn = known ? !!accounts[id] : playbackResolvers.includes(id);
  // Setup first, unless the host knows the account is signed in: being
  // switched on is no sign of a plug-in being set up.
  if (setupNeeded && setupNeeded[id] && !(known && accounts[id])) {
    const field = requiredSetting(resolver);
    return { state: 'setup', label: field ? `Add your ${field.label}` : 'Set up' };
  }
  if (!signedIn) return { state: 'connect', label: null };
  if (limit && limit.blocked) return { state: 'limited', label: limit.label || 'Can’t play on this plan' };
  if (!playbackResolvers.includes(id)) return { state: 'connect', label: null };
  return { state: 'connected', label: null };
}

// Something to play from: a service that needs an account is signed in and
// playing, or a music folder is added.
function serviceConnected(services, opts) {
  return (services || []).some((r) => serviceState(r, opts).state === 'connected');
}

// Scrobbling counts as connected once any scrobbling plug-in has an account
// name saved (Last.fm, ListenBrainz, Libre.fm, or a new one).
function scrobblerConnected(metaServiceConfigs) {
  return Object.values(metaServiceConfigs || {}).some((c) => !!(c && c.username));
}

// The scrobbling plug-ins (capabilities.scrobbling), from the registry.
function scrobblerPlugins(metaServices) {
  return (Array.isArray(metaServices) ? metaServices : []).filter((s) => caps(s).scrobbling);
}

// The three steps, in order, each done or not; `current` is the first one
// not done (null when all are).
//   connect: a service that needs an account is signed in, or a music
//            folder is added
//   music:   anything in the collection or a playlist, or a scrobbler
//            connected (the issue's lean)
//   listen:  something has played
function gettingStartedSteps({ connected = false, folderAdded = false, hasMusic = false, scrobbling = false, played = false } = {}) {
  const steps = [
    { id: 'connect', done: !!(connected || folderAdded) },
    { id: 'music', done: !!(hasMusic || scrobbling) },
    { id: 'listen', done: !!played },
  ];
  const next = steps.find((s) => !s.done);
  return { steps, current: next ? next.id : null, allDone: !next, done: steps.filter((s) => s.done).length };
}

// The remembered state (store key 'home_getting_started'):
//   { active, played }
//   active  the layout is on: set on a new install (and by the welcome tour's
//           last screen), cleared by "Skip setup for now" and once all three
//           steps are done
//   played  something has played since the layout came on
// A profile from before this shipped has no key and tutorial_completed set:
// it never gets the layout (the issue's lean on upgrades).
//   skipped "Skip setup for now" was used: the "Finish setting up" pill then
//           offers the steps until they're done
function initialGettingStarted(saved, tutorialCompleted) {
  if (saved && typeof saved === 'object') return { active: saved.active === true, played: saved.played === true, skipped: saved.skipped === true };
  return { active: !tutorialCompleted, played: false, skipped: false };
}

// The pill's "Finish getting started": skipped, and steps still open.
function gettingStartedLeft(state, status) {
  return !!(state && state.skipped && !state.active && status && !status.allDone);
}

function showGettingStarted(state, status) {
  return !!(state && state.active && status && !status.allDone);
}

module.exports = {
  LOCAL_FILES_ID,
  playsHere,
  needsAccount,
  requiredSetting,
  settingsMissing,
  setupMissing,
  stepOnePlugins,
  serviceState,
  serviceConnected,
  scrobblerConnected,
  scrobblerPlugins,
  gettingStartedSteps,
  initialGettingStarted,
  gettingStartedLeft,
  showGettingStarted,
};
