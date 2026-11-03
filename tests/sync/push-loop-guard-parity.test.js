/**
 * Twin-loop guard parity (parachord#1223, maintainer re-scope).
 *
 * The two legacy playlist loops — the background-sync push loop (inside the
 * mount effect) and the post-wizard create loop (inside `startSync`) — are
 * structural twins that must carry the same guards. docs/architecture/sync.md
 * says it as a rule ("Keep them in sync — if you add a guard or branch to
 * one, add it to the other"), which until now has been a comment, not a gate.
 * Both loops stand down in N-way `new` mode and are deleted in Phase 4 of the
 * n-way migration (docs/plans/2026-06-28-legacy-to-nway-sync-migration.md),
 * so they are NOT deduplicated — this parity test is the cheap gate that
 * holds them together until deletion.
 *
 * For every guard in the list below, both loop regions must contain the
 * guard's code marker. If a guard is missing from ONE loop, the loops have
 * drifted: file the divergence as its own PR (the #1223 handoff rule), don't
 * edit one loop to match here.
 *
 * Known, documented asymmetries (asserted as such, not drift):
 * - Cancel-on-focus (`backgroundSyncCancelledRef`) is background-only. The
 *   wizard's manual sync is exempt from cancel-on-focus by design (sync.md
 *   "Wizard sync is exempt" — the user is engaged with the wizard; the sync
 *   runs to completion).
 * - The background loop's post-save `setPlaylists` merges in-memory hosted
 *   playlists (`hostedOnly`); the wizard loop's is a plain replace. Found
 *   while writing this test — reported on #1223 as a candidate divergence
 *   bug for its own PR, so it is deliberately NOT asserted here yet.
 */

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js');
const source = fs.readFileSync(APP, 'utf8');

// Locate the two loop regions: each is bracketed by the mutex acquisition
// (playlistSyncInProgressRef.current.add) and its finally-release (delete),
// starting at the N-way stand-down read just above the acquisition. These
// are the only two add-sites in the file (the loops are the only writers).
function loopRegions(src) {
  const ADD = 'playlistSyncInProgressRef.current.add(providerId)';
  const DELETE = 'playlistSyncInProgressRef.current.delete(providerId)';
  const ENGINE_MODE = "await window.electron.store.get('sync_engine_mode')";
  const regions = [];
  let idx = 0;
  while ((idx = src.indexOf(ADD, idx)) !== -1) {
    const modeRead = src.lastIndexOf(ENGINE_MODE, idx);
    if (modeRead === -1) throw new Error('loop region: engine-mode read not found above mutex add');
    const end = src.indexOf(DELETE, idx);
    if (end === -1) throw new Error('loop region: mutex release not found below mutex add');
    regions.push(src.slice(modeRead, end + DELETE.length));
    idx = end + DELETE.length;
  }
  return regions;
}

// Every guard both loops must carry. Markers are code (not comments) so a
// deleted guard cannot survive via a stale comment.
const PARITY_GUARDS = [
  {
    name: 'N-way stand-down (sync_engine_mode === "new" skips the legacy loop)',
    markers: ["engineMode === 'new'"],
  },
  {
    name: 'per-provider mutex: acquire only when not held, release in finally',
    markers: [
      'playlistSyncInProgressRef.current.has(providerId)',
      'playlistSyncInProgressRef.current.add(providerId)',
      'playlistSyncInProgressRef.current.delete(providerId)',
    ],
  },
  {
    name: 'localOnly playlists skip the loop entirely',
    markers: ['if (playlist.localOnly) continue;'],
  },
  {
    name: 'provider-scoped syncedFrom guard (multi-provider mirror propagation)',
    markers: [
      'const sourceProvider = playlist.syncedFrom?.resolver;',
      'if (sourceProvider === providerId)',
    ],
  },
  {
    name: 'collaborative push-back exemption (genuine local edits pass the source guard)',
    markers: [
      'const hasGenuineLocalEdits = playlist.locallyModified',
      '(playlist.lastModified || 0) > sourceSyncedAt',
    ],
  },
  {
    name: 'imported-id prefix guard (defense-in-depth twin of the syncedFrom guard)',
    markers: ['playlist.id?.startsWith(`${providerId}-`)'],
  },
  {
    name: 'pendingAction playlists skip (a deferred deletion/rename is in flight)',
    markers: ['playlist.syncedTo?.[providerId]?.pendingAction) continue;'],
  },
  {
    name: 'LB channel gate (per-playlist re-export opt-in; listenbrainz-*/hosted- defaults; SYNC: sync-engine/playlist-push-candidate.js channelGateBlocksCreate)',
    markers: [
      'const chOverride = channelOverrides[playlist.id];',
      'Array.isArray(chOverride)',
      "playlist.id?.startsWith('listenbrainz-')",
      "playlist.id?.startsWith('hosted-') && providerId === 'listenbrainz'",
      // The edit branch (already-linked playlists) re-checks the override —
      // without this marker the gate holds via the create-branch occurrence
      // alone and deleting the edit-branch check from one loop stays green.
      'if (Array.isArray(chOverride) && !chOverride.includes(providerId)) continue;',
    ],
  },
  {
    name: 'create-vs-update branch structure (syncInfo absent → create; locallyModified → update push)',
    markers: [
      'const syncInfo = playlist.syncedTo?.[providerId];',
      'else if (playlist.locallyModified) {',
      // The 404 handling on a failed update push flags pendingAction so the
      // UI can surface a remote deletion instead of re-pushing forever.
      "playlist.syncedTo[providerId].pendingAction = 'remote-deleted';",
    ],
  },
  {
    name: 'LB auto-create opt-in (pushLocalPlaylists flood-guard, override bypass)',
    markers: ['lbOptedInByOverride'],
  },
  {
    name: 'LB circuit breaker (3 consecutive write failures stop the run) — definition plus one call per write branch',
    markers: [{ text: 'noteLbOutcome(', min: 2 }, 'const noteLbOutcome = (ok) =>', 'lbConsecutiveFailures >= 3'],
  },
  {
    name: 'per-iteration idle yield (renderer stays responsive mid-loop, #798) — main loop + save loop',
    markers: [{ text: 'await yieldToIdle();', min: 2 }],
  },
  {
    name: 'inter-IPC breathe (250ms spread so sync IPCs cannot starve the UI) — once per write branch',
    markers: [{ text: 'await breathe();', min: 2 }, 'const SYNC_IPC_DELAY_MS = 250;'],
  },
  {
    name: 'post-push locallyModified clear is relevantMirrors-scoped (source provider excluded)',
    markers: [
      'const relevantMirrors = enabledProviders.filter(pid =>',
      'pid !== sourceProvider',
    ],
  },
  {
    name: 'save loop writes only modified playlists, throttled every 5 saves',
    markers: [
      'if (!modifiedPlaylistIds.has(playlist.id)) continue;',
      'saveCount % 5 === 0',
    ],
  },
];

// occurrence in the save loop; noteLbOutcome's definition plus one call site per
// write branch; breathe appears once per write branch. Without the counts,
// deleting one of the duplicate occurrences from a single loop stays green.
function missingGuards(region) {
  const missing = [];
  for (const guard of PARITY_GUARDS) {
    for (const marker of guard.markers) {
      const need = marker.min || 1;
      const text = typeof marker === 'string' ? marker : marker.text;
      const count = region.split(text).length - 1;
      if (count < need) {
        missing.push(`${guard.name} — expected ${need}× marker: ${text} (found ${count})`);
      }
    }
  }
  return missing;
}

describe('legacy playlist push/create twin loops (background sync + post-wizard)', () => {
  const regions = loopRegions(source);

  test('exactly two loop regions exist (the twin loops are the only mutex writers)', () => {
    expect(regions).toHaveLength(2);
  });

  test('every parity guard is present in BOTH loops (the "keep them in sync" rule, as a gate)', () => {
    const [background, wizard] = regions;
    const missing = {
      backgroundLoop: missingGuards(background),
      wizardLoop: missingGuards(wizard),
    };
    const failures = [];
    if (missing.backgroundLoop.length) failures.push(`background-sync push loop:\n  - ${missing.backgroundLoop.join('\n  - ')}`);
    if (missing.wizardLoop.length) failures.push(`post-wizard create loop:\n  - ${missing.wizardLoop.join('\n  - ')}`);
    expect(failures).toEqual([]);
  });

  test('cancel-on-focus is background-only: the wizard sync is exempt by design (sync.md)', () => {
    const [background, wizard] = regions;
    expect(background).toContain('backgroundSyncCancelledRef.current');
    expect(wizard).not.toContain('backgroundSyncCancelledRef');
  });

  test('negative control: dropping a guard from one loop fails the parity check', () => {
    const [background, wizard] = regions;
    // Strip the pendingAction skip from the wizard region only.
    const brokenWizard = wizard.replace('playlist.syncedTo?.[providerId]?.pendingAction) continue;', '/* guard dropped */');
    const missing = missingGuards(brokenWizard);
    expect(missing.some((m) => m.includes('pendingAction'))).toBe(true);
    // And the untouched region still passes, so the failure is the drift, not the check.
    expect(missingGuards(background)).toEqual([]);
    expect(missingGuards(wizard)).toEqual([]);
    // The edit-branch channel gate is separately guarded: deleting it from one
    // loop must fail even though the create-branch gate still matches.
    const brokenBg = background.replace('if (Array.isArray(chOverride) && !chOverride.includes(providerId)) continue;', '/* guard dropped */');
    const missingBg = missingGuards(brokenBg);
    expect(missingBg.some((m) => m.includes('channel gate'))).toBe(true);
  });
});
