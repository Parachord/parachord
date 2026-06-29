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
  // Was missing the playlistFolders key the other providers declare; LB has
  // no folder concept.
  playlistFolders: false,
  // N-way materialize dispatch (parachord#911). LB's playlist update is
  // clear-then-add (no full-replace PUT), which maps to positional removal.
  // Playlist delete + rename (title/description) are supported.
  trackRemoveMode: 'ByPosition',
  canReorder: false,
  supportsPlaylistDelete: true,
  supportsPlaylistRename: true,
};

function authHeaders(token) {
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
  };
}

const LB_MAX_RETRIES = 3;
const lbSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Authenticated LB API request with retry-with-backoff (parachord#868). Mirrors
// spotify.js's spotifyRequest: a 429 honors `Retry-After`; 502/503/504 and
// network errors use exponential backoff `min(1000·2^n, 30000)`; max
// LB_MAX_RETRIES. Returns the final Response so callers keep their own non-OK
// handling (e.g. the 404 → remoteDeleted check in updatePlaylistTracks) — retries
// only absorb transient blips on a single batch, never mask a real 4xx.
async function lbRequest(endpoint, token, options = {}, _retry = 0) {
  const url = endpoint.startsWith('http') ? endpoint : `${LB_BASE}${endpoint}`;
  const { method = 'GET', body } = options;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: authHeaders(token),
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
  } catch (err) {
    if (_retry >= LB_MAX_RETRIES) throw err;
    await lbSleep(Math.min(1000 * 2 ** _retry, 30000));
    return lbRequest(endpoint, token, options, _retry + 1);
  }
  if (res.status === 429 && _retry < LB_MAX_RETRIES) {
    const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
    await lbSleep((Number.isFinite(ra) ? ra : 5) * 1000);
    return lbRequest(endpoint, token, options, _retry + 1);
  }
  if ([502, 503, 504].includes(res.status) && _retry < LB_MAX_RETRIES) {
    await lbSleep(Math.min(1000 * 2 ** _retry, 30000));
    return lbRequest(endpoint, token, options, _retry + 1);
  }
  return res;
}

// Per-token cache of the LB username so a single sync run (which makes N
// playlist-create + N playlist-update calls) doesn't fire 2N /1/validate-token
// GETs in quick succession. Without this cache, syncing 142 playlists meant
// 284 LB API calls just for username lookup — enough to trip the LB
// per-IP throttle around the ~10th-15th playlist.
//
// Cache survives across calls within the renderer's lifetime; cleared by
// process restart. Token is the cache key so a token-rotation correctly
// invalidates the prior cached username.
const _usernameCache = new Map();

async function getUserName(token) {
  if (token && _usernameCache.has(token)) return _usernameCache.get(token);
  // GET /1/validate-token returns { user_name, valid }
  // Diagnostic logging to surface why validate-token disagrees with itself
  // across call sites — token works in fetchPlaylists but fails in createPlaylist.
  const tokenPreview = token ? `${String(token).slice(0, 8)}...(len=${String(token).length})` : 'NULL/EMPTY';
  let res;
  try {
    res = await lbRequest('/1/validate-token', token);
  } catch (err) {
    console.warn(`[LB] validate-token fetch threw for token ${tokenPreview}:`, err && err.message ? err.message : err);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[LB] validate-token returned HTTP ${res.status} for token ${tokenPreview}; body: ${body.slice(0, 300)}`);
    throw new Error(`LB validate-token returned ${res.status}`);
  }
  const data = await res.json();
  if (!data.valid || !data.user_name) {
    console.warn(`[LB] validate-token rejected token ${tokenPreview}; response: ${JSON.stringify(data).slice(0, 300)}`);
    throw new Error('LB token invalid');
  }
  if (token) _usernameCache.set(token, data.user_name);
  return data.user_name;
}

// Resolve a single track to a recording MBID. Tries (1) track.mbid, (2)
// MBID Mapper. Returns the MBID or null.
//
// `hydration` (optional, parachord#953) is the flood guard built by main.js:
// `{ resolve(track) → { skip, mbid }, record(track, mbid) }`. It short-circuits
// the live mapper call when the track is already resolved/cooled-down in the
// persistent negative cache OR the per-cycle budget is spent, and records each
// live attempt so an un-findable track isn't re-queried every sync. Absent (no
// arg) → direct lookup every time (legacy behavior, e.g. ad-hoc callers).
async function resolveTrackMbid(track, hydration) {
  if (track?.mbid && /^[a-f0-9-]{36}$/i.test(track.mbid)) return track.mbid;
  if (!track?.artist || !track?.title) return null;
  if (hydration) {
    const decision = hydration.resolve(track);
    // skip = use the cached id (resolved) or give up this cycle (cooldown / over
    // budget); a fresh / cooldown-expired track returns skip:false to look up live.
    if (decision && decision.skip) return decision.mbid || null;
  }
  let resolved = null;
  try {
    const url = new URL('https://mapper.listenbrainz.org/mapping/lookup');
    url.searchParams.set('artist_credit_name', track.artist);
    url.searchParams.set('recording_name', track.title);
    if (track.album) url.searchParams.set('release_name', track.album);
    const res = await fetch(url.toString());
    if (res.ok) {
      const data = await res.json();
      if (data?.recording_mbid && typeof data.confidence === 'number' && data.confidence >= 0.7) {
        resolved = data.recording_mbid;
      }
    }
  } catch {
    resolved = null;
  }
  if (hydration) hydration.record(track, resolved);
  return resolved;
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
  const res = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}`, token);
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
// Signature `(name, description, token)` matches the sibling spotify.js /
// applemusic.js providers — main.js's `sync:create-playlist` handler calls
// `provider.createPlaylist(name, description, token)` then separately calls
// `provider.updatePlaylistTracks(externalId, tracks, token)` to push tracks.
// LB technically supports both create-empty + push-tracks AND create-with-
// tracks in one POST, but matching the sibling contract keeps the call site
// uniform across providers (no special-casing in main.js). Track MBID
// resolution happens inside `updatePlaylistTracks`, not here.
async function createPlaylist(name, description, token) {
  const userName = await getUserName(token);
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
      track: [],
    },
  };
  const res = await lbRequest('/1/playlist/create', token, { method: 'POST', body });
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
  };
}
async function updatePlaylistTracks(playlistMbid, tracks, token, opts = {}) {
  const { knownSnapshotId, mergeWithRemote = false } = opts;

  // ── Step 1: Resolve all incoming tracks to MBIDs ───────────────────
  // opts.hydration (parachord#953) bounds the per-cycle mapper lookups + skips
  // cooled-down misses; absent → resolve every track live (legacy behavior).
  const hydration = opts && opts.hydration;
  const resolvedTracks = [];
  const unresolvedTracks = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t, hydration);
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
  if (hydration && hydration.flush) hydration.flush();

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
  const cur = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}`, token);
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

  // ── Step 3.5: Short-circuit when remote already matches ────────────
  //
  // If the post-merge intended track list is identical (same recording
  // MBIDs in the same order) to what's already on the remote, the
  // delete + re-add pair would be a no-op that still costs ~one LB API
  // call per playlist push cycle. Skip it. Order-aware comparison —
  // LB respects playlist order, so a reorder still has to fall through
  // to the clear-and-add. This mirrors the inbound short-circuit
  // shipped in #796 (canShortCircuitPlaylistUpdate) for the opposite
  // direction.
  //
  // The big real-world payoff is hosted-XSPF mirror pushes that fire
  // every time the upstream XSPF blob differs by whitespace or
  // ordering-quirk but the actual track list is unchanged. Today's
  // session: 6 hosted-mirror pushes back-to-back held
  // `playlistSyncInProgressRef` for ~6 minutes and starved Daily Brew's
  // diff phase. With this short-circuit, when remote already matches
  // the incoming list (the common case for steady-state mirrors), the
  // expensive delete + batched-add disappears.
  const extractRecordingMbid = (track) => {
    const ids = Array.isArray(track?.identifier)
      ? track.identifier
      : (track?.identifier ? [track.identifier] : []);
    for (const id of ids) {
      const m = String(id || '').match(/recording\/([a-f0-9-]{36})/i);
      if (m) return m[1].toLowerCase();
    }
    return null;
  };
  const localMbidsInOrder = resolvedTracks.map(extractRecordingMbid);
  const remoteMbidsInOrder = remoteTracks.map(extractRecordingMbid);
  const remoteAlreadyMatches =
    localMbidsInOrder.length === remoteMbidsInOrder.length
    && localMbidsInOrder.every((m, i) => m !== null && m === remoteMbidsInOrder[i]);
  if (remoteAlreadyMatches) {
    console.log(`[LB] Skipping push for ${playlistMbid}: remote already matches (${localMbidsInOrder.length} tracks)`);
    return {
      snapshotId: remoteSnapshotDate,
      unresolvedTracks,
    };
  }

  // ── Step 4: Clear remote (same pattern as the rest of the file) ───
  if (currentLen > 0) {
    const delRes = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}/item/delete`, token, {
      method: 'POST',
      body: { index: 0, count: currentLen },
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
    const addRes = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}/item/add`, token, {
      method: 'POST',
      body: { playlist: { track: batch } },
    });
    if (!addRes.ok) {
      const text = await addRes.text().catch(() => '');
      throw new Error(`LB add tracks returned ${addRes.status}: ${text.slice(0, 200)}`);
    }
  }

  // ── Step 6: Re-fetch fresh snapshot anchor ─────────────────────────
  let newSnapshotId = null;
  try {
    const cur = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}`, token);
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
  const res = await lbRequest(`/1/playlist/edit/${encodeURIComponent(playlistMbid)}`, token, { method: 'POST', body });
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
  const res = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}/delete`, token, { method: 'POST' });
  if (!res.ok) {
    return { success: false, reason: `status-${res.status}` };
  }
  return { success: true };
}

// ── N-way incremental write primitives (parachord#911) ──────────────
// ListenBrainz is `trackRemoveMode: 'ByPosition'` — its JSPF playlist API has
// no delete-by-id; only delete-by-index. Dormant until the N-way reconcile
// driver calls these (real writes gated OFF).

// The native id LB resolution operates on — the bare recording MBID,
// trim+lowercased (matches the engine's mbid tier; null when absent).
function nativeIdOf(track) {
  const raw = (track && (track.recordingMbid || track.mbid)) || '';
  const norm = String(raw).trim().toLowerCase();
  return norm.length > 0 ? norm : null;
}

/**
 * Remove specific tracks from a playlist by their 0-based positions.
 * POST /1/playlist/<mbid>/item/delete { index, count: 1 } per position,
 * issued DESCENDING so an earlier delete never shifts the index of a position
 * still to be removed. Returns the refreshed JSPF last_modified anchor.
 * @param {string} playlistMbid
 * @param {number[]} positions
 * @param {string} token
 * @returns {Promise<{snapshotId:string|null}>}
 */
async function removePlaylistTracksByPosition(playlistMbid, positions, token) {
  const sorted = (Array.isArray(positions) ? positions : [])
    .filter((p) => Number.isInteger(p) && p >= 0)
    .sort((a, b) => b - a); // descending — delete from the back forward
  for (const index of sorted) {
    const res = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}/item/delete`, token, {
      method: 'POST',
      body: { index, count: 1 },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LB delete-by-position returned ${res.status}: ${text.slice(0, 200)}`);
    }
  }
  // Re-fetch the fresh snapshot anchor (same pattern as updatePlaylistTracks).
  let snapshotId = null;
  try {
    const cur = await lbRequest(`/1/playlist/${encodeURIComponent(playlistMbid)}`, token);
    if (cur.ok) {
      const data = await cur.json();
      snapshotId =
        data?.playlist?.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.last_modified_at
        || data?.playlist?.date
        || null;
    }
  } catch {}
  return { snapshotId };
}

// Cheap remote auth check — hits /1/validate-token. Mirrors the
// `checkAuth(token) -> boolean` contract spotify.js and applemusic.js export
// so `provider.checkAuth(token)` in main.js's `sync:check-auth` handler
// works uniformly across providers.
async function checkAuth(token) {
  if (!token) return false;
  try {
    const res = await lbRequest('/1/validate-token', token);
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.valid;
  } catch {
    return false;
  }
}

// Pre-resolve tracks to recording MBIDs so the create gateway can refuse to
// create an EMPTY remote when nothing resolves (a hosted XSPF whose tracks lack
// MBIDs would otherwise leave a 0-track LB playlist behind). Mirrors the
// `{ resolved, unresolved }` contract spotify/applemusic expose. The resolved
// tracks carry their `mbid`, so updatePlaylistTracks's own resolveTrackMbid
// returns it immediately (no second mapper round-trip).
async function resolveTracks(tracks, token, opts = {}) {
  const hydration = opts && opts.hydration;
  const resolved = [];
  const unresolved = [];
  for (const t of tracks || []) {
    const mbid = await resolveTrackMbid(t, hydration);
    if (mbid) resolved.push({ ...t, mbid });
    else unresolved.push({ artist: t.artist, title: t.title, album: t.album });
  }
  if (hydration && hydration.flush) hydration.flush();
  return { resolved, unresolved };
}

module.exports = {
  resolveTracks,
  lbRequest, // exported for retry-behavior tests (parachord#868)
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
  nativeIdOf,
  removePlaylistTracksByPosition,
};
