// embed-players.js — host-owned adapters for resolvers that play through a
// service's own embeddable player.
//
// A plugin opts in with `capabilities.embedPlayer: true` and names its
// adapter in a top-level `"embedPlayer": { "adapter": "<name>" }` block (not
// in `capabilities`: Android and iOS decode capability values as booleans,
// and a string there makes them drop the whole plugin). The host routes by
// that capability (never by resolver id), so a second service is one adapter
// here plus those manifest lines. Adapters are host code on purpose:
// each speaks its service's player protocol itself, so no third-party script
// runs in the main renderer beside window.electron.
//
// An adapter's player exposes:
//   load(link, handlers) → Promise   resolves once playback has advanced;
//                                    rejects with reason 'unplayable' (the
//                                    service won't play it here) or
//                                    'superseded'
//   stop()                           halts it (never only pauses)
//   isActive()
//   element                          HTMLMediaElement-shaped facade: paused,
//                                    currentTime, duration, volume, play(),
//                                    pause() — what seek/volume/transport drive
// handlers: onProgress(seconds), onDuration(seconds), onPlay(), onPause(),
// onFinish().
//
// linkFor(source) picks the link the adapter loads from a resolver's source
// record. Players are created on first use (this module loads under plain
// Node, where there is no document).

'use strict';

const { createSoundCloudWidgetPlayer } = require('./soundcloud-widget-player');

const ADAPTERS = {
  'soundcloud-widget': {
    create: () => createSoundCloudWidgetPlayer(),
    linkFor: (source) => (source && source.soundcloudUrl) || null
  }
};

const players = new Map();

function embedPlayer(kind) {
  const adapter = ADAPTERS[kind];
  if (!adapter) return null;
  if (!players.has(kind)) players.set(kind, adapter.create());
  return players.get(kind);
}

function embedLinkFor(kind, source) {
  const adapter = ADAPTERS[kind];
  return adapter ? adapter.linkFor(source) : null;
}

// Halt every embed player that has been created (a no-op for idle ones).
function stopAllEmbedPlayers(log = console) {
  for (const [kind, player] of players) {
    try {
      player.stop();
    } catch (e) {
      log.error(`Error stopping the ${kind} embed player:`, e);
    }
  }
}

module.exports = { embedPlayer, embedLinkFor, stopAllEmbedPlayers, EMBED_PLAYER_KINDS: Object.keys(ADAPTERS) };
