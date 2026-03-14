# Local Playlist Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Auto-sync locally created playlists to Spotify/Apple Music so they sync between desktop and the upcoming Android app.

**Architecture:** Extend sync providers with `createPlaylist` + `resolveTracks` methods, add a `sync:create-playlist` IPC handler, and extend the background sync loop to auto-create and auto-push local playlists. UI additions are minimal: sync status icons, a local-only toggle, and a remote-deletion prompt.

**Tech Stack:** Electron IPC, Spotify Web API, Apple Music Library API, React (createElement, no JSX)

**Design doc:** `docs/plans/2026-03-14-local-playlist-sync-design.md`

---

### Task 1: Add `createPlaylist` and `resolveTracks` to Spotify Provider

**Files:**
- Modify: `sync-providers/spotify.js:680-690` (before module.exports)

**Step 1: Add `resolveTracks` method**

Add after `deletePlaylist` (line 688), before `module.exports` (line 690):

```javascript
  // Resolve local tracks to Spotify URIs by searching
  async resolveTracks(tracks, token) {
    const resolved = [];
    const unresolved = [];

    for (const track of tracks) {
      try {
        const query = `track:"${track.title}" artist:"${track.artist}"`;
        const result = await spotifyRequest(
          `/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
          token
        );

        const items = result.tracks?.items || [];
        // Find best match — exact title + artist match (case-insensitive)
        const match = items.find(item =>
          item.name.toLowerCase() === track.title.toLowerCase() &&
          item.artists.some(a => a.name.toLowerCase() === track.artist.toLowerCase())
        ) || items[0]; // Fall back to top result

        if (match) {
          resolved.push({
            ...track,
            spotifyUri: match.uri
          });
        } else {
          unresolved.push({ artist: track.artist, title: track.title });
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to resolve track "${track.title}" by "${track.artist}":`, error.message);
        unresolved.push({ artist: track.artist, title: track.title });
      }
    }

    return { resolved, unresolved };
  },
```

**Step 2: Add `createPlaylist` method**

Add after `resolveTracks`:

```javascript
  // Create a new playlist on Spotify
  async createPlaylist(name, description, token) {
    // Get current user ID
    const user = await spotifyRequest('/me', token);

    const playlist = await spotifyRequest(`/users/${user.id}/playlists`, token, {
      method: 'POST',
      body: {
        name,
        description: description || '',
        public: false
      }
    });

    return {
      externalId: playlist.id,
      snapshotId: playlist.snapshot_id
    };
  },
```

**Step 3: Verify no syntax errors**

Run: `node -c sync-providers/spotify.js`
Expected: No output (clean parse)

**Step 4: Commit**

```
feat: add createPlaylist and resolveTracks to Spotify sync provider
```

---

### Task 2: Add `createPlaylist`, `updatePlaylistTracks`, `updatePlaylistDetails`, and `resolveTracks` to Apple Music Provider

**Files:**
- Modify: `sync-providers/applemusic.js:335-351` (before module.exports)

**Step 1: Add `resolveTracks` method**

Add after `deletePlaylist` (line 348), before the closing `};` and `module.exports`:

```javascript
  // Resolve local tracks to Apple Music catalog IDs by searching
  async resolveTracks(tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);
    const resolved = [];
    const unresolved = [];

    for (const track of tracks) {
      try {
        const query = `${track.title} ${track.artist}`;
        const resp = await fetch(
          `${APPLE_MUSIC_API_BASE}/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=5`,
          {
            headers: {
              'Authorization': `Bearer ${developerToken}`,
              'Music-User-Token': userToken
            }
          }
        );

        if (!resp.ok) {
          unresolved.push({ artist: track.artist, title: track.title });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        const data = await resp.json();
        const items = data.results?.songs?.data || [];

        // Find best match — exact title + artist match (case-insensitive)
        const match = items.find(item =>
          item.attributes.name.toLowerCase() === track.title.toLowerCase() &&
          item.attributes.artistName.toLowerCase() === track.artist.toLowerCase()
        ) || items[0];

        if (match) {
          resolved.push({
            ...track,
            appleMusicId: match.id,
            appleMusicCatalogId: match.id
          });
        } else {
          unresolved.push({ artist: track.artist, title: track.title });
        }

        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) {
        console.error(`Failed to resolve track "${track.title}" by "${track.artist}":`, error.message);
        unresolved.push({ artist: track.artist, title: track.title });
      }
    }

    return { resolved, unresolved };
  },
```

**Step 2: Add `createPlaylist` method**

```javascript
  // Create a new playlist on Apple Music
  async createPlaylist(name, description, token) {
    const { developerToken, userToken } = JSON.parse(token);

    const resp = await fetch(`${APPLE_MUSIC_API_BASE}/me/library/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${developerToken}`,
        'Music-User-Token': userToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attributes: {
          name,
          description: description || ''
        }
      })
    });

    if (!resp.ok) {
      throw new Error(`Failed to create Apple Music playlist: ${resp.status}`);
    }

    const data = await resp.json();
    const playlist = data.data?.[0];

    return {
      externalId: playlist.id,
      snapshotId: playlist.attributes?.lastModifiedDate || new Date().toISOString()
    };
  },
```

**Step 3: Add `updatePlaylistTracks` method**

```javascript
  // Replace all tracks in an Apple Music playlist
  async updatePlaylistTracks(playlistId, tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);

    // Filter to tracks with Apple Music catalog IDs
    const catalogTracks = tracks.filter(t => t.appleMusicCatalogId || t.appleMusicId);

    const body = {
      data: catalogTracks.map(t => ({
        id: t.appleMusicCatalogId || t.appleMusicId,
        type: 'songs'
      }))
    };

    const resp = await fetch(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}/tracks`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!resp.ok) {
      throw new Error(`Failed to update Apple Music playlist tracks: ${resp.status}`);
    }

    // Fetch updated snapshot
    const snapshot = await this.getPlaylistSnapshot(playlistId, token);

    return { success: true, snapshotId: snapshot };
  },
```

**Step 4: Add `updatePlaylistDetails` method**

```javascript
  // Update playlist name and description on Apple Music
  async updatePlaylistDetails(playlistId, metadata, token) {
    const { developerToken, userToken } = JSON.parse(token);

    const attributes = {};
    if (metadata.name) attributes.name = metadata.name;
    if (metadata.description !== undefined) attributes.description = metadata.description || '';

    if (Object.keys(attributes).length === 0) {
      return { success: true };
    }

    const resp = await fetch(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ attributes })
      }
    );

    if (!resp.ok) {
      throw new Error(`Failed to update Apple Music playlist details: ${resp.status}`);
    }

    return { success: true };
  },
```

**Step 5: Verify no syntax errors**

Run: `node -c sync-providers/applemusic.js`
Expected: No output (clean parse)

**Step 6: Commit**

```
feat: add createPlaylist, updatePlaylistTracks, updatePlaylistDetails, resolveTracks to Apple Music provider
```

---

### Task 3: Add `sync:create-playlist` IPC Handler

**Files:**
- Modify: `main.js` — add after `sync:push-playlist` handler (after line 5376)
- Modify: `preload.js:340` — add new API method

**Step 1: Add IPC handler in main.js**

Insert after the `sync:push-playlist` handler (after line 5376):

```javascript
  // Create a new playlist on a remote service from a local playlist
  ipcMain.handle('sync:create-playlist', async (event, providerId, name, description, tracks) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider || !provider.capabilities.playlists) {
      return { success: false, error: 'Provider does not support playlists' };
    }

    if (!provider.createPlaylist) {
      return { success: false, error: 'Provider does not support creating playlists' };
    }

    let token;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    }

    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      // Step 1: Resolve tracks to provider-specific IDs
      let resolved = tracks;
      let unresolved = [];
      if (provider.resolveTracks) {
        const resolveResult = await provider.resolveTracks(tracks, token);
        resolved = resolveResult.resolved;
        unresolved = resolveResult.unresolved;
        console.log(`[Sync] Resolved ${resolved.length}/${tracks.length} tracks for ${providerId} (${unresolved.length} unresolved)`);
      }

      // Step 2: Create the playlist
      const { externalId, snapshotId } = await provider.createPlaylist(name, description, token);
      console.log(`[Sync] Created playlist "${name}" on ${providerId}: ${externalId}`);

      // Step 3: Add tracks
      let finalSnapshotId = snapshotId;
      if (resolved.length > 0 && provider.updatePlaylistTracks) {
        const updateResult = await provider.updatePlaylistTracks(externalId, resolved, token);
        finalSnapshotId = updateResult.snapshotId || snapshotId;
      }

      return {
        success: true,
        externalId,
        snapshotId: finalSnapshotId,
        unresolvedTracks: unresolved
      };
    } catch (error) {
      console.error(`[Sync] Failed to create playlist on ${providerId}:`, error.message);
      return { success: false, error: error.message };
    }
  });
```

**Step 2: Add preload API method**

In `preload.js`, add after the `pushPlaylist` line (line 340):

```javascript
    createPlaylist: (providerId, name, description, tracks) => ipcRenderer.invoke('sync:create-playlist', providerId, name, description, tracks),
```

**Step 3: Verify no syntax errors**

Run: `node -c main.js && node -c preload.js`
Expected: No output (clean parse)

**Step 4: Commit**

```
feat: add sync:create-playlist IPC handler with track resolution
```

---

### Task 4: Extend `markPlaylistAsLocallyModified` and Background Sync

**Files:**
- Modify: `app.js:15229-15237` — extend `markPlaylistAsLocallyModified` to include `syncedTo` playlists
- Modify: `app.js:5396-5462` — extend `runBackgroundSync` with playlist creation and auto-push

**Step 1: Update `markPlaylistAsLocallyModified`**

Replace lines 15229-15237 in `app.js`:

```javascript
  // Mark a synced playlist as locally modified (for sync push handling)
  // Affects playlists with syncedFrom (pulled from service) OR syncedTo (pushed to service)
  const markPlaylistAsLocallyModified = (playlistId) => {
    setPlaylists(prev => prev.map(p =>
      p.id === playlistId && (p.syncedFrom || p.syncedTo)
        ? { ...p, locallyModified: true, lastModified: Date.now() }
        : p
    ));
  };
```

**Step 2: Add helper to save playlist `syncedTo` metadata to disk**

Add right after `markPlaylistAsLocallyModified`:

```javascript
  // Update a playlist's syncedTo metadata and save to disk
  const updatePlaylistSyncedTo = async (playlistId, providerId, syncData) => {
    setPlaylists(prev => {
      const updated = prev.map(p => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          syncedTo: {
            ...p.syncedTo,
            [providerId]: syncData
          }
        };
      });
      // Save the updated playlist to disk
      const playlist = updated.find(p => p.id === playlistId);
      if (playlist) {
        window.electron.playlists.save(playlist);
      }
      return updated;
    });
  };
```

**Step 3: Extend `runBackgroundSync` with playlist auto-create and auto-push**

In `app.js`, inside `runBackgroundSync`, after the existing playlist reload block (after the `if (settings.syncPlaylists)` try/catch block around line 5447), add:

```javascript
              // Auto-sync local playlists to this provider
              try {
                const allPlaylists = await window.electron.playlists.load();
                let playlistsChanged = false;

                for (const playlist of allPlaylists) {
                  // Skip playlists that are local-only or synced FROM this provider
                  if (playlist.localOnly) continue;
                  if (playlist.syncedFrom) continue;

                  // Skip playlists with pending actions
                  if (playlist.syncedTo?.[providerId]?.pendingAction) continue;

                  const syncInfo = playlist.syncedTo?.[providerId];

                  if (!syncInfo) {
                    // Playlist not yet created on this provider — create it
                    console.log(`[Sync] Creating playlist "${playlist.title}" on ${providerId}`);
                    try {
                      const result = await window.electron.sync.createPlaylist(
                        providerId,
                        playlist.title,
                        playlist.description || '',
                        playlist.tracks || []
                      );
                      if (result.success) {
                        playlist.syncedTo = {
                          ...playlist.syncedTo,
                          [providerId]: {
                            externalId: result.externalId,
                            snapshotId: result.snapshotId,
                            syncedAt: Date.now(),
                            unresolvedTracks: result.unresolvedTracks || [],
                            pendingAction: null
                          }
                        };
                        playlistsChanged = true;
                        console.log(`[Sync] Created playlist "${playlist.title}" on ${providerId}: ${result.externalId}`);
                      }
                    } catch (err) {
                      console.warn(`[Sync] Failed to create playlist "${playlist.title}" on ${providerId}:`, err.message);
                    }
                  } else if (playlist.locallyModified) {
                    // Playlist exists remotely and has local changes — push updates
                    console.log(`[Sync] Pushing updates for "${playlist.title}" to ${providerId}`);
                    try {
                      const result = await window.electron.sync.pushPlaylist(
                        providerId,
                        syncInfo.externalId,
                        playlist.tracks || [],
                        { name: playlist.title, description: playlist.description || '' }
                      );
                      if (result?.success) {
                        playlist.syncedTo[providerId] = {
                          ...playlist.syncedTo[providerId],
                          snapshotId: result.snapshotId,
                          syncedAt: Date.now()
                        };
                        playlistsChanged = true;
                      } else if (result?.error?.includes('404') || result?.error?.includes('Not Found')) {
                        // Remote playlist was deleted
                        playlist.syncedTo[providerId].pendingAction = 'remote-deleted';
                        playlistsChanged = true;
                        console.warn(`[Sync] Remote playlist "${playlist.title}" was deleted on ${providerId}`);
                      }
                    } catch (err) {
                      if (err.message?.includes('404') || err.message?.includes('Not Found')) {
                        playlist.syncedTo[providerId].pendingAction = 'remote-deleted';
                        playlistsChanged = true;
                      }
                      console.warn(`[Sync] Failed to push playlist "${playlist.title}" to ${providerId}:`, err.message);
                    }
                  }
                }

                // Reset locallyModified for playlists synced to ALL providers
                if (playlistsChanged) {
                  const enabledProviders = Object.entries(resolverSyncSettingsRef.current)
                    .filter(([, s]) => s.enabled)
                    .map(([id]) => id);

                  for (const playlist of allPlaylists) {
                    if (playlist.locallyModified && playlist.syncedTo) {
                      const allSynced = enabledProviders.every(pid =>
                        playlist.syncedTo[pid]?.syncedAt >= (playlist.lastModified || 0)
                      );
                      if (allSynced) {
                        playlist.locallyModified = false;
                      }
                    }
                  }

                  // Save all changes to disk and update UI
                  for (const playlist of allPlaylists) {
                    await window.electron.playlists.save(playlist);
                  }
                  setPlaylists(allPlaylists);
                }
              } catch (err) {
                console.warn(`[Sync] Local playlist sync failed for ${providerId}:`, err.message);
              }
```

**Step 4: Verify no syntax errors**

Run: `node -c app.js`
Expected: Error (app.js uses React/browser APIs). Instead verify manually that braces balance.

**Step 5: Commit**

```
feat: extend background sync to auto-create and auto-push local playlists
```

---

### Task 5: Add `sync:push-playlist` Support for `syncedTo` Playlists (Ownership Bypass)

**Files:**
- Modify: `main.js:5337-5376` — the `sync:push-playlist` handler

**Context:** The current `pushPlaylist` handler checks `checkPlaylistOwnership` which compares the playlist owner with the current user. For `syncedTo` playlists, we always own them (we created them), but the ownership check makes an extra API call. More critically, if the Apple Music provider doesn't have `checkPlaylistOwnership`, it returns false by default. We need to handle this.

**Step 1: Update the handler to also get Apple Music token**

In the `sync:push-playlist` handler, the token retrieval only handles Spotify (line 5348-5350). Add Apple Music token retrieval:

After the Spotify token block:
```javascript
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    }
```

**Step 2: Verify and commit**

Run: `node -c main.js`
Expected: No output (clean parse)

```
fix: add Apple Music token support to sync:push-playlist handler
```

---

### Task 6: UI — Sync Status Indicators and Local-Only Toggle

**Files:**
- Modify: `app.js` — playlist detail view (around line 37748)

**Step 1: Add remote deletion banner**

In the playlist detail view, before the existing sync banner (line 37748), add a new section for `syncedTo` pending actions:

```javascript
          // Remote deletion banner for syncedTo playlists
          (() => {
            if (!playlist?.syncedTo) return null;
            const pendingProviders = Object.entries(playlist.syncedTo)
              .filter(([, info]) => info.pendingAction === 'remote-deleted');
            if (pendingProviders.length === 0) return null;

            return pendingProviders.map(([providerId, info]) => {
              const providerName = providerId === 'spotify' ? 'Spotify' : providerId === 'applemusic' ? 'Apple Music' : providerId;
              return React.createElement('div', {
                key: `remote-deleted-${providerId}`,
                className: `mx-4 mt-3 p-3 rounded-lg border`,
                style: { background: 'rgba(234, 179, 8, 0.12)', borderColor: 'rgba(234, 179, 8, 0.25)' }
              },
                React.createElement('div', { className: 'text-sm font-medium text-yellow-700 mb-2' },
                  `"${playlist.title}" was deleted on ${providerName}`
                ),
                React.createElement('div', { className: 'flex gap-2' },
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors',
                    onClick: async () => {
                      // Delete locally too
                      await window.electron.playlists.delete(playlist.id);
                      setPlaylists(prev => prev.filter(p => p.id !== playlist.id));
                      setSelectedPlaylist(null);
                    }
                  }, 'Delete locally too'),
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors',
                    onClick: async () => {
                      // Keep local, stop syncing to this provider
                      const updatedSyncedTo = { ...playlist.syncedTo };
                      delete updatedSyncedTo[providerId];
                      const hasAnySyncedTo = Object.keys(updatedSyncedTo).length > 0;
                      const updatedPlaylist = {
                        ...playlist,
                        syncedTo: hasAnySyncedTo ? updatedSyncedTo : undefined,
                        localOnly: !hasAnySyncedTo ? true : playlist.localOnly
                      };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === playlist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                    }
                  }, 'Stop syncing'),
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors',
                    onClick: async () => {
                      // Re-create on service — clear syncedTo for this provider
                      const updatedSyncedTo = { ...playlist.syncedTo };
                      delete updatedSyncedTo[providerId];
                      const updatedPlaylist = {
                        ...playlist,
                        syncedTo: Object.keys(updatedSyncedTo).length > 0 ? updatedSyncedTo : undefined
                      };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === playlist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                      showToast(`Will re-create "${playlist.title}" on ${providerName} during next sync`);
                    }
                  }, 'Re-create')
                )
              );
            });
          })(),
```

**Step 2: Add sync status icons and local-only toggle**

Find the playlist metadata/header area in the detail view. Add sync status indicators showing which services the playlist is synced to, and a local-only toggle. This should appear near the playlist title area.

Look for the playlist detail header rendering (search for where `playlist.title` is rendered in the detail view) and add after it:

```javascript
          // Sync status for syncedTo playlists
          playlist?.syncedTo && !playlist.syncedFrom && React.createElement('div', {
            className: 'flex items-center gap-2 mt-1'
          },
            // Provider icons
            ...Object.keys(playlist.syncedTo).map(pid =>
              React.createElement('span', {
                key: pid,
                className: `text-xs px-2 py-0.5 rounded-full ${
                  pid === 'spotify' ? 'bg-green-100 text-green-700' : 'bg-pink-100 text-pink-700'
                }`,
                title: `Synced to ${pid === 'spotify' ? 'Spotify' : 'Apple Music'}`
              }, pid === 'spotify' ? 'Spotify' : 'Apple Music')
            ),
            // Local only toggle
            React.createElement('button', {
              className: `text-xs px-2 py-0.5 rounded-full transition-colors ${
                playlist.localOnly
                  ? 'bg-gray-200 text-gray-600'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
              }`,
              onClick: async () => {
                const updatedPlaylist = { ...playlist, localOnly: !playlist.localOnly };
                setSelectedPlaylist(updatedPlaylist);
                setPlaylists(prev => prev.map(p => p.id === playlist.id ? updatedPlaylist : p));
                await window.electron.playlists.save(updatedPlaylist);
                showToast(updatedPlaylist.localOnly ? 'Playlist set to local only' : 'Playlist will sync to services');
              }
            }, playlist.localOnly ? 'Local only' : 'Syncing')
          ),
```

**Step 3: Commit**

```
feat: add sync status UI, local-only toggle, and remote deletion prompt for synced playlists
```

---

### Task 7: Handle 404 in Push Flow

**Files:**
- Modify: `main.js:5337-5376` — `sync:push-playlist` handler

**Step 1: Detect 404 errors and return specific error code**

In the `sync:push-playlist` handler, wrap the push calls in try/catch that detects 404:

Replace the try/catch block (lines 5357-5375):

```javascript
    try {
      // Check if user owns the playlist (can only push to owned playlists)
      if (provider.checkPlaylistOwnership) {
        const isOwner = await provider.checkPlaylistOwnership(playlistExternalId, token);
        if (!isOwner) {
          return { success: false, error: 'You can only push changes to playlists you own' };
        }
      }

      // Push metadata changes (name, description) if provided
      if (metadata && provider.updatePlaylistDetails) {
        await provider.updatePlaylistDetails(playlistExternalId, metadata, token);
      }

      // Push track changes
      const result = await provider.updatePlaylistTracks(playlistExternalId, tracks, token);
      return { success: true, snapshotId: result.snapshotId };
    } catch (error) {
      // Detect remote playlist deletion (404)
      if (error.message?.includes('404') || error.message?.includes('Not Found') || error.status === 404) {
        return { success: false, error: 'PLAYLIST_NOT_FOUND', message: 'The remote playlist no longer exists' };
      }
      return { success: false, error: error.message };
    }
```

**Step 2: Update background sync to check for PLAYLIST_NOT_FOUND**

This is already handled in Task 4's push logic which checks for `404` and `Not Found` in error messages. Update it to also check for the specific `PLAYLIST_NOT_FOUND` error code:

In the background sync push section (from Task 4), update the error check:

```javascript
                      if (result?.success) {
                        // ... existing success handling
                      } else if (result?.error === 'PLAYLIST_NOT_FOUND' || result?.error?.includes('404')) {
                        // Remote playlist was deleted
                        playlist.syncedTo[providerId].pendingAction = 'remote-deleted';
                        playlistsChanged = true;
                        console.warn(`[Sync] Remote playlist "${playlist.title}" was deleted on ${providerId}`);
                      }
```

**Step 3: Verify and commit**

Run: `node -c main.js`
Expected: No output (clean parse)

```
feat: detect remote playlist deletion (404) and flag for user action
```

---

### Task 8: Resolve Tracks Before Push for `syncedTo` Auto-Push

**Files:**
- Modify: `app.js` background sync section (Task 4 code)

**Context:** When auto-pushing updates to a `syncedTo` playlist, the tracks may not have provider-specific URIs (e.g., `spotifyUri`). The existing `pushPlaylist` handler calls `updatePlaylistTracks` which filters to tracks with URIs. We need to resolve tracks before pushing, same as we do for initial creation.

**Step 1: Add track resolution before push in background sync**

In the auto-push section of the background sync (from Task 4), before calling `pushPlaylist`, add resolution:

```javascript
                    // Resolve tracks before pushing (local tracks may lack provider-specific URIs)
                    let tracksToSync = playlist.tracks || [];
                    try {
                      const resolveResult = await window.electron.sync.createPlaylist(
                        providerId, null, null, tracksToSync
                      );
                      // Actually, we need a separate resolve endpoint...
                    }
```

**Wait — better approach:** Instead of a separate resolve endpoint, modify the `sync:push-playlist` handler to accept an option to resolve tracks first. OR add a `sync:resolve-tracks` IPC handler.

Actually, the simplest approach: add a `sync:resolve-tracks` IPC handler and call it from the background sync before pushing.

**Step 1 (revised): Add `sync:resolve-tracks` IPC handler in main.js**

Add after the `sync:create-playlist` handler:

```javascript
  // Resolve local tracks to provider-specific IDs
  ipcMain.handle('sync:resolve-tracks', async (event, providerId, tracks) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider?.resolveTracks) {
      return { success: false, error: 'Provider does not support track resolution' };
    }

    let token;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    }

    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const result = await provider.resolveTracks(tracks, token);
      return { success: true, resolved: result.resolved, unresolved: result.unresolved };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

**Step 2: Add preload API method**

In `preload.js`, add:

```javascript
    resolveTracks: (providerId, tracks) => ipcRenderer.invoke('sync:resolve-tracks', providerId, tracks),
```

**Step 3: Update background sync push to resolve first**

In the auto-push section, before calling `pushPlaylist`:

```javascript
                    // Resolve tracks to provider-specific URIs before pushing
                    let tracksForPush = playlist.tracks || [];
                    try {
                      const resolveResult = await window.electron.sync.resolveTracks(providerId, tracksForPush);
                      if (resolveResult.success) {
                        tracksForPush = resolveResult.resolved;
                        // Update unresolved tracks list
                        playlist.syncedTo[providerId].unresolvedTracks = resolveResult.unresolved;
                      }
                    } catch (resolveErr) {
                      console.warn(`[Sync] Track resolution failed for "${playlist.title}" on ${providerId}:`, resolveErr.message);
                    }

                    const result = await window.electron.sync.pushPlaylist(
                      providerId,
                      syncInfo.externalId,
                      tracksForPush,  // Use resolved tracks
                      { name: playlist.title, description: playlist.description || '' }
                    );
```

**Step 4: Verify and commit**

```
feat: add sync:resolve-tracks IPC handler and resolve before auto-push
```

---

### Task 9: Final Integration Test

**Step 1: Manual testing checklist**

1. Create a local playlist with 3-5 tracks
2. Wait for background sync (or reduce `SYNC_INTERVAL` temporarily)
3. Verify playlist appears on Spotify
4. Add a track to the local playlist
5. Wait for next sync cycle
6. Verify track appears on Spotify playlist
7. Delete playlist on Spotify directly
8. Wait for next sync cycle
9. Verify remote-deleted banner appears
10. Test each action: delete locally, stop syncing, re-create
11. Create a new playlist and mark as "local only"
12. Verify it does NOT appear on Spotify after sync

**Step 2: Commit any fixes from testing**

**Step 3: Final commit**

```
docs: mark local playlist sync design as implemented
```
