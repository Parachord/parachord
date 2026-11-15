// A playlist save must not drop a mirror link that is still live. PURE: no
// electron, no store.
//
// `playlists-save` replaces the stored record with the renderer's copy. A copy
// made before a link was written (a push loop's snapshot, the hosted-XSPF
// reload, a stale React state) carries no `syncedTo[provider]`, so saving it
// erased the link: one person's ten hosted playlists had lost their Apple Music
// links and kept losing their Spotify ones, and each sync relinked them from
// the durable map (`sync_playlist_links`). Nothing reached the services, but
// the records were never right.
//
// The guard keeps an entry only when the save leaves it out entirely AND both
// the stored record and the durable map hold the same external id. Every
// deliberate removal (detach, the duplicate cleanup, a failed create) clears
// the durable link first, so it is never undone here. A save that carries a
// different entry for the provider wins: that is a real change.

function keepDroppedLinks(incoming, stored, durableLinks) {
  const storedTo = stored?.syncedTo;
  if (!incoming || !storedTo || typeof storedTo !== 'object') return { playlist: incoming, kept: [] };
  const links = (durableLinks && incoming.id && durableLinks[incoming.id]) || {};
  const incomingTo = incoming.syncedTo && typeof incoming.syncedTo === 'object' ? incoming.syncedTo : {};
  const kept = [];
  const restored = { ...incomingTo };
  for (const [providerId, entry] of Object.entries(storedTo)) {
    if (!entry?.externalId) continue;
    if (Object.prototype.hasOwnProperty.call(incomingTo, providerId)) continue;
    if (links[providerId]?.externalId !== entry.externalId) continue;
    restored[providerId] = entry;
    kept.push(providerId);
  }
  if (kept.length === 0) return { playlist: incoming, kept };
  return { playlist: { ...incoming, syncedTo: restored }, kept };
}

module.exports = { keepDroppedLinks };
