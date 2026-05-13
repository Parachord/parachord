// ListenBrainz playlist sync provider.
//
// Uses JSPF for playlist body and recording MBIDs as the canonical track
// identifier. The user token used here is the SCROBBLER-side token (key
// `scrobbler-config-listenbrainz`.userToken), not the meta-service config —
// see CLAUDE.md "ListenBrainz auth token auto-attach" for the rationale.
//
// Capability matrix (mirrors the shape used by spotify.js / applemusic.js):
//   - playlists: true
//   - tracks: false   (LB has no library-of-tracks concept)
//   - albums: false   (LB has no library-of-albums concept)
//   - artists: false  (LB has no library-of-artists concept)

const LB_BASE = 'https://api.listenbrainz.org';

const capabilities = {
  playlists: true,
  tracks: false,
  albums: false,
  artists: false,
};

function authHeaders(token) {
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getUserName(token) {
  // GET /1/validate-token returns { user_name, valid }
  const res = await fetch(`${LB_BASE}/1/validate-token`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`LB validate-token returned ${res.status}`);
  const data = await res.json();
  if (!data.valid || !data.user_name) throw new Error('LB token invalid');
  return data.user_name;
}

// Resolve a single track to a recording MBID. Tries (1) track.mbid, (2)
// MBID Mapper. Returns the MBID or null. The mapper is fast (~4ms) and
// the result is opportunistically cached by callers via the existing
// `cache_mbid_mapper` electron-store key — but here in main-process
// sync-provider code we just hit the mapper directly each time. The
// renderer-side enrichment loop populates the cache for the next pass.
async function resolveTrackMbid(track) {
  if (track?.mbid && /^[a-f0-9-]{36}$/i.test(track.mbid)) return track.mbid;
  if (!track?.artist || !track?.title) return null;
  try {
    const url = new URL('https://mapper.listenbrainz.org/mapping/lookup');
    url.searchParams.set('artist_credit_name', track.artist);
    url.searchParams.set('recording_name', track.title);
    if (track.album) url.searchParams.set('release_name', track.album);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.recording_mbid && typeof data.confidence === 'number' && data.confidence >= 0.7) {
      return data.recording_mbid;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Stubs for now; filled in by Tasks 7–11 ──
async function fetchPlaylists(token, _onProgress, _refreshToken) {
  const userName = await getUserName(token);
  // LB returns 25 playlists per page by default. Paginate via `count` / `offset`.
  const PAGE_SIZE = 50;
  let offset = 0;
  const playlists = [];
  while (true) {
    const res = await fetch(
      `${LB_BASE}/1/user/${encodeURIComponent(userName)}/playlists?count=${PAGE_SIZE}&offset=${offset}`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) throw new Error(`LB fetchPlaylists returned ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.playlists) ? data.playlists : [];
    if (items.length === 0) break;
    for (const item of items) {
      const p = item?.playlist;
      if (!p?.identifier) continue;
      const mbidMatch = p.identifier.match(/playlist\/([a-f0-9-]{36})/i);
      if (!mbidMatch) continue;
      const externalId = mbidMatch[1];

      // Collaborator detection: a user is considered "owner-capable" if
      // they're the creator OR appear in the playlist's collaborators
      // extension. This enables cross-service collaboration — see the
      // "Cross-service collaboration via LB" section at the top of the plan.
      const ext = p.extension?.['https://musicbrainz.org/doc/jspf#playlist'] || {};
      const creator = (p.creator || '').toLowerCase();
      const userLower = userName.toLowerCase();
      const collaborators = Array.isArray(ext.collaborators)
        ? ext.collaborators
            .map(c => typeof c === 'string' ? c : (c?.name || c?.user_name || ''))
            .filter(Boolean)
            .map(c => c.toLowerCase())
        : [];
      const isOwnedByUser = creator === userLower || collaborators.includes(userLower);
      const isCollaborator = !!collaborators.length && creator !== userLower && collaborators.includes(userLower);

      playlists.push({
        externalId,
        id: `listenbrainz-${externalId}`,
        name: p.title || 'Untitled',
        description: p.annotation || '',
        ownerName: p.creator || userName,
        ownerId: p.creator || userName,
        isOwnedByUser,
        // `isCollaborator` is surfaced to the UI for the "shared playlist"
        // badge (Task 13-bis). Owner-only playlists have it false.
        isCollaborator,
        collaborators,
        snapshotId: ext.last_modified_at || p.date || null,
        trackCount: Array.isArray(p.track) ? p.track.length : 0,
        // Surface visibility so the wizard / cleanup UI can show it
        isPublic: !!ext.public,
      });
    }
    if (items.length < PAGE_SIZE) break;
    offset += items.length;
  }

  // LB's user-playlists endpoint returns "JSPF metadata without recordings"
  // (per https://listenbrainz.readthedocs.io/en/latest/users/api/playlist.html),
  // so `p.track` above is always `[]` and there's no `track_count` field
  // anywhere in the response — verified empirically against the live API:
  // the root carries `playlist_count` (count of playlists, not tracks) and
  // the JSPF extension has `last_modified_at`/`creator`/`public` only.
  //
  // To populate trackCount we issue a per-playlist fetch against
  // GET /1/playlist/{mbid}, which DOES return the full track array. Done
  // sequentially after the main pagination loop so the wizard can show
  // the playlist names immediately while counts fill in. Worst case is N
  // round-trips (~100ms each), bounded by the listing's `playlist_count`.
  for (const pl of playlists) {
    if (pl.trackCount > 0) continue;
    try {
      const res = await fetch(
        `${LB_BASE}/1/playlist/${encodeURIComponent(pl.externalId)}`,
        { headers: authHeaders(token) },
      );
      if (res.ok) {
        const data = await res.json();
        const tracks = data?.playlist?.track;
        if (Array.isArray(tracks)) pl.trackCount = tracks.length;
      }
    } catch {
      // Non-fatal; leave trackCount as 0 for this one.
    }
  }

  return { playlists };
}
async function fetchPlaylistTracks(playlistMbid, token, _onProgress, _refreshToken) {
  const res = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`LB fetchPlaylistTracks returned ${res.status}`);
  const data = await res.json();
  const tracks = Array.isArray(data?.playlist?.track) ? data.playlist.track : [];
  return tracks.map((t, i) => {
    // JSPF identifier can be a string OR an array of strings (per JSPF spec).
    // Handle both. We extract the recording MBID from the MusicBrainz URL.
    const ids = Array.isArray(t.identifier) ? t.identifier : (t.identifier ? [t.identifier] : []);
    let mbid = null;
    for (const id of ids) {
      const m = String(id).match(/musicbrainz\.org\/recording\/([a-f0-9-]{36})/i);
      if (m) { mbid = m[1]; break; }
    }
    return {
      id: `listenbrainz-track-${playlistMbid}-${i}`,
      title: t.title || '',
      artist: t.creator || '',
      album: t.album || undefined,
      duration: typeof t.duration === 'number' ? t.duration / 1000 : undefined, // JSPF ms → s
      mbid,
      addedAt: Date.now(),  // JSPF doesn't carry per-track add timestamps
      sources: {},
    };
  });
}
async function createPlaylist(name, description, tracks, token) {
  const userName = await getUserName(token);
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t);
    if (mbid) {
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: t.title || '',
        creator: t.artist || '',
      });
    } else {
      unresolvedTracks.push({ artist: t.artist, title: t.title, album: t.album });
    }
  }
  const body = {
    playlist: {
      title: name,
      annotation: description || '',
      extension: {
        'https://musicbrainz.org/doc/jspf#playlist': {
          // Default-private. Hard-coded; see CLAUDE.md "ListenBrainz Playlist
          // Sync" section for rationale and the user-toggle follow-up.
          public: false,
          creator: userName,
        },
      },
      track: resolvedTracks,
    },
  };
  const res = await fetch(`${LB_BASE}/1/playlist/create`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LB createPlaylist returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const externalId = data?.playlist_mbid;
  if (!externalId) throw new Error('LB createPlaylist: no playlist_mbid in response');
  return {
    externalId,
    snapshotId: null,  // LB doesn't return one on create; first fetchPlaylists tick populates
    unresolvedTracks,
  };
}
async function updatePlaylistTracks(playlistMbid, tracks, token, opts = {}) {
  const { knownSnapshotId, mergeWithRemote = false } = opts;

  // ── Step 1: Resolve all incoming tracks to MBIDs ───────────────────
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t);
    if (mbid) {
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: t.title || '',
        creator: t.artist || '',
      });
    } else {
      unresolvedTracks.push({ artist: t.artist, title: t.title, album: t.album });
    }
  }

  // ── Step 2: Fetch current remote (for both clear count AND merge) ──
  //
  // Failure-mode handling matters here: a silent-catch on 5xx would let
  // the function proceed with `currentLen=0`, skip the delete step, and
  // add tracks on top of unfetched-but-existing remote tracks → silent
  // DUPLICATES. So we distinguish:
  //   - 404 → remote playlist was deleted; return early so caller can
  //           flag `pendingAction: 'remote-deleted'` (matches AM pattern)
  //   - Other non-OK / network error → throw, force the caller to retry
  let remoteSnapshotDate = null;
  let remoteTracks = [];
  let currentLen = 0;
  const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
    headers: authHeaders(token),
  });
  if (cur.status === 404) {
    return { snapshotId: null, unresolvedTracks, remoteDeleted: true };
  }
  if (!cur.ok) {
    const text = await cur.text().catch(() => '');
    throw new Error(`LB fetch current playlist returned ${cur.status}: ${text.slice(0, 200)}`);
  }
  const data = await cur.json();
  const p = data?.playlist || {};
  remoteSnapshotDate = p.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
    || p.date
    || null;
  remoteTracks = Array.isArray(p.track) ? p.track : [];
  currentLen = remoteTracks.length;

  // ── Step 3: Merge-before-push (collaborative case) ─────────────────
  //
  // If the caller signals this is a collaborative playlist AND the remote
  // snapshot has advanced since we last knew about it, someone else
  // (another collaborator) made changes between our last pull and this
  // push. Union the unfamiliar remote additions into our outbound payload
  // so we don't wipe their work.
  //
  // "Unfamiliar" = present in remote, identified by recording MBID, not
  // in our local resolved set. This loses fine-grained ordering for
  // foreign additions (they end up appended) but preserves their
  // existence — the priority is data preservation over ordering.
  if (
    mergeWithRemote
    && knownSnapshotId
    && remoteSnapshotDate
    && remoteSnapshotDate !== knownSnapshotId
  ) {
    const localMbidSet = new Set(
      resolvedTracks
        .map(t => {
          const id = Array.isArray(t.identifier) ? t.identifier[0] : t.identifier;
          const m = String(id || '').match(/recording\/([a-f0-9-]{36})/i);
          return m ? m[1] : null;
        })
        .filter(Boolean),
    );
    let foreignAdded = 0;
    for (const rt of remoteTracks) {
      const ids = Array.isArray(rt.identifier) ? rt.identifier : (rt.identifier ? [rt.identifier] : []);
      let mbid = null;
      for (const id of ids) {
        const m = String(id).match(/recording\/([a-f0-9-]{36})/i);
        if (m) { mbid = m[1]; break; }
      }
      if (!mbid || localMbidSet.has(mbid)) continue;
      resolvedTracks.push({
        identifier: [`https://musicbrainz.org/recording/${mbid}`],
        title: rt.title || '',
        creator: rt.creator || '',
      });
      foreignAdded++;
    }
    if (foreignAdded > 0) {
      console.log(`[LB] Merged ${foreignAdded} foreign track(s) from collaborator(s) before push`);
    }
  }

  // ── Step 4: Clear remote (same pattern as the rest of the file) ───
  if (currentLen > 0) {
    const delRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/delete`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ index: 0, count: currentLen }),
    });
    if (!delRes.ok) {
      const text = await delRes.text().catch(() => '');
      throw new Error(`LB clear tracks returned ${delRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // ── Step 5: Add the merged set in batches ──────────────────────────
  const BATCH = 100;
  for (let i = 0; i < resolvedTracks.length; i += BATCH) {
    const batch = resolvedTracks.slice(i, i + BATCH);
    const addRes = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/item/add`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ playlist: { track: batch } }),
    });
    if (!addRes.ok) {
      const text = await addRes.text().catch(() => '');
      throw new Error(`LB add tracks returned ${addRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // ── Step 6: Re-fetch fresh snapshot anchor ─────────────────────────
  let newSnapshotId = null;
  try {
    const cur = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}`, {
      headers: authHeaders(token),
    });
    if (cur.ok) {
      const data = await cur.json();
      newSnapshotId = data?.playlist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
        || data?.playlist?.date
        || null;
    }
  } catch {}

  return { snapshotId: newSnapshotId, unresolvedTracks };
}
async function updatePlaylistDetails(playlistMbid, details, token) {
  const body = {
    playlist: {
      title: details?.name ?? details?.title,
      annotation: details?.description ?? '',
    },
  };
  const res = await fetch(`${LB_BASE}/1/playlist/edit/${encodeURIComponent(playlistMbid)}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Don't throw — see CLAUDE.md "Apple Music fallback behavior" rationale.
    // Track-push happens AFTER details-push in sync:push-playlist; a throw
    // here would abort the track push too. Log + return success-with-skip.
    console.warn(`[LB] updatePlaylistDetails returned ${res.status}: ${text.slice(0, 200)}`);
    return { success: true, skipped: `status-${res.status}` };
  }
  return { success: true };
}
async function deletePlaylist(playlistMbid, token) {
  const res = await fetch(`${LB_BASE}/1/playlist/${encodeURIComponent(playlistMbid)}/delete`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!res.ok) {
    return { success: false, reason: `status-${res.status}` };
  }
  return { success: true };
}

// Cheap remote auth check — hits /1/validate-token. Mirrors the
// `checkAuth(token) -> boolean` contract spotify.js and applemusic.js export
// so `provider.checkAuth(token)` in main.js's `sync:check-auth` handler
// works uniformly across providers.
async function checkAuth(token) {
  if (!token) return false;
  try {
    const res = await fetch(`${LB_BASE}/1/validate-token`, { headers: authHeaders(token) });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.valid;
  } catch {
    return false;
  }
}

module.exports = {
  id: 'listenbrainz',
  // Sibling providers (spotify.js, applemusic.js) export `displayName`, and
  // main.js's sync-provider listing reads `p.displayName` (main.js:5756).
  // Match that contract.
  displayName: 'ListenBrainz',
  capabilities,
  checkAuth,
  fetchPlaylists,
  fetchPlaylistTracks,
  createPlaylist,
  updatePlaylistTracks,
  updatePlaylistDetails,
  deletePlaylist,
};
