// src/renderer/hooks/use-loves.js: the Loves state domain, extracted from
// app.js (parachord#1487 "Scrobbling and Loves"; #1559 step 1, before loves
// become a plug-in capability). docs/architecture/sync.md "Loved Tracks" and
// docs/architecture/scrobbling.md.
//
// Owns: the per-service "Push loves to X" setting (scrobbler_love_push_enabled)
// and the push marks (love_pushed_keys, lovePushedKeysRef); the in-memory
// retry queue and its 5-minute runner; the backfill ("Send N loved tracks to
// X") with its running flag and progress; the import with its running flag,
// progress and cursor (love_import_cursor). Actions: pushLoveToScrobblers
// (a heart's live push), setLovePushEnabled, runLoveBackfill, runLoveImport.
//
// Moved VERBATIM: the state, the ref-sync effect and every function and
// effect body below are the code that sat in Parachord, in the same order,
// with the hooks React.-qualified. Only the bridge wrappers just below are
// new.
//
// What stays in app.js, reading this hook's return: the bulk load that fills
// the setting, the marks and the cursor from the store; addTrackToCollection
// (calls pushLoveToScrobblers for a heart); removeTrackFromCollection (drops
// the removed row's retry entry and push mark); deriveTombstoneEntries (reads
// a mark's MBID); the plug-in dialog's props.
//
// Rules for this file (the extracted-module rule for hooks):
//   - React.-qualified hooks only (React.useState etc.), never bare
//     destructured hooks.
//   - No window access at module import time (tests require this file under
//     plain Node).
//   - Inputs arrive as refs/parameters, never component-state closures.
//
// Effect-order note (see use-volume.js for the full version): this hook's
// two effects run where Parachord calls useLoves (after the Collection
// state), ahead of every effect declared below the call. Both moved up: the
// ref sync from beside the other ref syncs, the retry runner from beside the
// push. Neither reads state another effect writes in the same commit: the
// sync copies the setting into its ref (read only by the push and the
// import, at event time), and the runner only starts a 5-minute interval.
// Their order relative to each other is kept (the sync first).

const LoveImport = require('../lib/love-import');
const { pluginName } = require('../lib/plugin-names');
const { countOf, andList } = require('../lib/plural');
const { loveProviderFor, loveProviderIds, lovesOf, lovedPageForImport, lovesPausedBySync } = require('../lib/love-providers');

function useLoves({
  collectionDataRef,
  collectionLoadingRef,
  setCollectionData,
  metaServicesRef,
  // The loaded plug-ins (resolvers), and the reader of a plug-in's saved
  // config: a plug-in that implements loves in its own .axe (#1559 step 3).
  loadedResolversRef,
  getResolverConfigRef,
  // Each service's sync settings: a service paused from the Sync menu gets
  // no love pushes either (#1445).
  resolverSyncSettingsRef,
  metaServiceConfigsRef,
  scrobblerConfigsRef,
  showSidebarBadge,
  // Late-function bridges: these functions are declared below the hook call
  // in Parachord, so they arrive as refs synced on every render (the same
  // idiom as use-local-files). Each is called only from a user action or an
  // awaited step, after the sync effects have filled them. Stable wrappers,
  // so the callbacks that list them keep their identity as before.
  showToastRef,
  showConfirmDialogRef,
  saveCollectionRef,
}) {
  const showToast = React.useCallback((...args) => showToastRef.current.apply(null, args), []);
  const showConfirmDialog = React.useCallback((...args) => showConfirmDialogRef.current.apply(null, args), []);
  const saveCollection = React.useCallback((...args) => saveCollectionRef.current.apply(null, args), []);

  // Loved-tracks push (opt-in per service). See
  // docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md.
  const [scrobblerLovePushEnabled, setScrobblerLovePushEnabled] = React.useState({});
  const scrobblerLovePushEnabledRef = React.useRef({});
  const lovePushedKeysRef = React.useRef({}); // { [trackId]: { lastfm?: ts, listenbrainz?: ts | { at, mbid } } }
  const [loveBackfillRunning, setLoveBackfillRunning] = React.useState({}); // { [service]: boolean }
  const loveBackfillRunningRef = React.useRef({});
  const [loveBackfillProgress, setLoveBackfillProgress] = React.useState({}); // { [service]: { done, total } }
  // Loved-tracks IMPORT (parachord#1071): the inbound half of the
  // loved-tracks scrobbler sync. One run per service, manual button in
  // the scrobbler's card; the cursor makes later runs only fetch new loves.
  const [loveImportRunning, setLoveImportRunning] = React.useState({}); // { [service]: boolean }
  const loveImportRunningRef = React.useRef({});
  const [loveImportProgress, setLoveImportProgress] = React.useState({}); // { [service]: { done, total, phase? } }
  const loveImportCursorRef = React.useRef({}); // { [service]: loved-at seconds — newest seen }
  // In-memory retry queue for love-pushes that failed transiently (mapper
  // 5xx/502, LB API 5xx/429, network errors). Walked by a periodic runner
  // that re-attempts pushLoveToScrobblers on each entry. Max 5 attempts,
  // then drop with a warning log. Not persisted across restarts — that's
  // a deliberate scope choice; the user can hit the backfill button to
  // catch up after a long mapper outage. Entries are auto-removed when
  // pushLoveToScrobblers succeeds for all enabled services on a given
  // track. Map keyed by trackId so re-loving a track doesn't stack
  // entries. parachord (Starting Line incident, 2026-06).
  const loveRetryQueueRef = React.useRef(new Map()); // Map<trackId, { track, attempts }>

  React.useEffect(() => { scrobblerLovePushEnabledRef.current = scrobblerLovePushEnabled; }, [scrobblerLovePushEnabled]);

  // Push a track's love to any service whose toggle is on. Idempotent
  // via lovePushedKeysRef — if already pushed, skips silently. Persists
  // checkpoints to electron-store immediately so backfill resumes
  // correctly across restarts. Used by both the live-add path
  // (addTrackToCollection above) and the manual backfill button.
  const pushLoveToScrobblers = React.useCallback(async (track, { justAdded = false } = {}) => {
    if (!track?.id) return;
    // A re-push (the periodic retry runner) must confirm the track is still in
    // the collection: a love landing on the service after the user removed the
    // track is dated newer than the removal and would come straight back on
    // the next import (issue #1071 review). The live add path skips this —
    // the row is being added as the push starts.
    if (!justAdded) {
      const stillThere = (collectionDataRef.current?.tracks || []).some((t) => t && t.id === track.id);
      if (!stillThere) {
        loveRetryQueueRef.current.delete(track.id);
        console.log(`[love-push] skip "${track.title}" — removed from the collection since the love was queued`);
        return;
      }
    }
    const enabled = scrobblerLovePushEnabledRef.current || {};
    const pushed = lovePushedKeysRef.current[track.id] || {};
    const tasks = [];

    // Every love provider whose "Push loves to X" is on and that doesn't have
    // this love yet (lib/love-providers.js, #1559): one path for all of them.
    for (const serviceId of loveProviderIds(loveServices())) {
      if (!enabled[serviceId] || pushed[serviceId] || pausedBySync(serviceId)) continue;
      const provider = providerOf(serviceId);
      const label = pluginName(serviceId);
      tasks.push((async () => {
        try {
          // Signed in is enough: "Scrobble to X" pauses scrobbling only.
          if (!(await provider.isSignedIn())) return;
          const result = await provider.loveTrack(track, providerConfig(serviceId));
          // It couldn't place the track (ListenBrainz: no recording MBID):
          // nothing is loved, and the retry below tries again later.
          if (!result || result.ok !== true) {
            console.log(`[love-push] ${label} skip "${track.title}" — no match`);
            return;
          }
          await markLovePushed(track.id, serviceId, result.ref);
          clearLoveTombstone(result.ref);
          console.log(`[love-push] ${label} ✓ ${track.artist} – ${track.title}`);
        } catch (err) {
          console.warn(`[love-push] ${label} failed for "${track.title}":`, err?.message || err);
        }
      })());
    }

    if (tasks.length > 0) await Promise.allSettled(tasks);

    // After each push attempt, check whether the track is fully pushed for
    // all enabled services. If anything is still pending (mapper down, LB
    // 429, network error, no MBID match, etc.), queue for retry; the
    // periodic retry runner below will re-attempt. If everything succeeded,
    // remove from the queue so we don't pointlessly re-check.
    // parachord (Starting Line incident, 2026-06).
    const post = lovePushedKeysRef.current[track.id] || {};
    const enabledNow = scrobblerLovePushEnabledRef.current || {};
    // A service paused with its sync isn't pending: nothing goes to it until
    // it's back on, and Send offers what it missed then.
    const pendingIds = loveProviderIds(loveServices()).filter((id) => !!enabledNow[id] && !post[id] && !pausedBySync(id));
    if (pendingIds.length > 0) {
      const existing = loveRetryQueueRef.current.get(track.id);
      const attempts = (existing?.attempts || 0) + 1;
      const MAX_ATTEMPTS = 5;
      if (attempts > MAX_ATTEMPTS) {
        loveRetryQueueRef.current.delete(track.id);
        const stillPending = pendingIds.join(', ');
        console.warn(`[love-push] giving up on "${track.artist} – ${track.title}" after ${MAX_ATTEMPTS} attempts (still pending: ${stillPending})`);
      } else {
        loveRetryQueueRef.current.set(track.id, { track, attempts });
      }
    } else if (loveRetryQueueRef.current.has(track.id)) {
      // Fully pushed — drop from queue if it was there from a prior failure.
      loveRetryQueueRef.current.delete(track.id);
    }
  }, []);

  // Periodic retry runner for the love-push queue. Walks any tracks that
  // failed to push fully last time, re-attempts via pushLoveToScrobblers
  // (which is idempotent — already-pushed services short-circuit at the
  // top via the lovePushedKeysRef check). 5-minute cadence is generous
  // enough that a transient mapper outage rarely costs more than 5-10
  // minutes of perceived staleness; combined with MAX_ATTEMPTS=5 in
  // pushLoveToScrobblers above, total retry window per love is up to 25
  // minutes. After that, the user can hit the manual backfill button to
  // mop up. parachord (Starting Line incident, 2026-06).
  React.useEffect(() => {
    const RETRY_INTERVAL_MS = 5 * 60 * 1000;
    const interval = setInterval(async () => {
      if (loveRetryQueueRef.current.size === 0) return;
      const entries = Array.from(loveRetryQueueRef.current.values());
      console.log(`[love-retry] checking ${entries.length} queued love(s)`);
      for (const { track } of entries) {
        try {
          await pushLoveToScrobblers(track);
        } catch (err) {
          console.warn(`[love-retry] retry threw for "${track.artist} – ${track.title}":`, err?.message || err);
        }
        // Soft pacing — don't burst the LB/mapper/MB APIs if the queue is
        // large. 500ms gap is small relative to a 5-minute cadence.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(interval);
    // pushLoveToScrobblers is stable (useCallback with empty deps), so
    // this effect mounts once.
  }, [pushLoveToScrobblers]);

  // Persist a single love-pushed checkpoint. Keeps the ref hot and
  // writes through to electron-store so a backfill mid-run survives
  // a crash.
  // A successful push that stored a recording MBID (ListenBrainz's `ref`)
  // clears the tombstone that MBID may have written on an earlier removal: a
  // re-add after a removal must import again, and the mark's MBID is the
  // tombstone key (parachord#1071 review). The MBID bucket is shared by every
  // service (LoveImport.MBID_TOMBSTONE_BUCKET).
  const clearLoveTombstone = (mbid) => {
    if (!mbid || !/^[a-f0-9-]{36}$/i.test(mbid) || !window.electron?.tombstones) return;
    window.electron.tombstones.clearBatch([{ providerId: LoveImport.MBID_TOMBSTONE_BUCKET, externalId: mbid }])
      .catch((err) => console.warn('[love-push] could not clear the recording\'s tombstone:', err?.message || err));
  };

  // Paused from the Sync menu (#1445): the switch for a service pauses
  // everything it syncs, its loves included (lib/love-providers.js).
  const pausedBySync = (serviceId) => lovesPausedBySync(resolverSyncSettingsRef && resolverSyncSettingsRef.current
    ? resolverSyncSettingsRef.current[serviceId] : null);

  // What a provider is handed with each call: its plug-in config.
  const providerConfig = (serviceId) =>
    scrobblerConfigsRef.current?.[serviceId] || metaServiceConfigsRef.current?.[serviceId] || {};

  // Every plug-in that could be a love provider: the meta-services (Last.fm,
  // ListenBrainz) and the loaded plug-ins (a server's stars, #1559 step 3).
  const loveServices = () => [...(metaServicesRef.current || []), ...((loadedResolversRef && loadedResolversRef.current) || [])];
  // The provider for an id: registered, or the plug-in's own methods with
  // its saved config.
  const providerOf = (serviceId) => loveProviderFor(loveServices().find((s) => s && s.id === serviceId), {
    getConfig: async () => ((getResolverConfigRef && getResolverConfigRef.current) ? (await getResolverConfigRef.current(serviceId)) || {} : {}),
  });

  // markLovePushed(trackId, service, mbid): the entry is the push timestamp,
  // or { at, mbid } when the push resolved a recording MBID (ListenBrainz) —
  // storing it means a later removal can tombstone the exact recording the
  // service holds, even though the collection row itself never carries it.
  // Both shapes are truthy, so every "already pushed" check keeps working.
  const markLovePushed = React.useCallback(async (trackId, service, mbid) => {
    const stamped = (typeof mbid === 'string' && /^[a-f0-9-]{36}$/i.test(mbid))
      ? { at: Date.now(), mbid }
      : Date.now();
    const next = {
      ...lovePushedKeysRef.current,
      [trackId]: { ...(lovePushedKeysRef.current[trackId] || {}), [service]: stamped },
    };
    lovePushedKeysRef.current = next;
    try { await window.electron.store.set('love_pushed_keys', next); }
    catch (_e) { /* non-fatal: ref is still hot for this session */ }
  }, []);

  // Toggle the live-push setting for a service. No automatic backfill
  // — the user has to click the backfill button explicitly.
  const setLovePushEnabled = React.useCallback(async (service, enabled) => {
    setScrobblerLovePushEnabled(prev => {
      const next = { ...prev, [service]: !!enabled };
      window.electron.store.set('scrobbler_love_push_enabled', next).catch(() => {});
      return next;
    });
  }, []);

  // Is this plug-in a love provider (lib/love-providers.js, #1559)? What it
  // declares (its manifest's `loves`), from the loaded meta-services; null
  // when it isn't one.
  const lovesFor = (service) => lovesOf(loveServices().find(s => s && s.id === service));

  // Manual backfill: walks the collection, pushes any track not yet
  // marked as pushed for this service. Soft rate-limit ~1 req/sec.
  // Idempotency cache means re-clicks are cheap.
  // { onlyIds } restricts the walk to those ids — the love-import's
  // confirmed cross-service push (parachord#1071): only what was just
  // imported goes to the other service, never the user's older unpushed
  // tracks, and never a per-track live push (which would flood the retry
  // queue when MBIDs can't resolve).
  const runLoveBackfill = React.useCallback(async (service, { onlyIds } = {}) => {
    if (loveBackfillRunningRef.current[service]) return;
    // A love provider (lib/love-providers.js, #1559; was two hard-coded names).
    const loves = lovesFor(service);
    if (!loves) return;
    const provider = providerOf(service);
    if (pausedBySync(service)) { showToast(`${pluginName(service)} sync is paused. Turn it on in the Collection’s Sync menu to send your loves.`); return; }
    // Signed in is enough: the scrobbling switch doesn't stop loved tracks.
    if (!(await provider.isSignedIn())) { showToast(`Sign in to ${pluginName(service)} to sync loved tracks`); return; }

    const tracks = (collectionDataRef.current?.tracks || []);
    const todo = tracks.filter(t => !lovePushedKeysRef.current[t.id]?.[service] && (!onlyIds || onlyIds.has(t.id)));
    if (todo.length === 0) {
      if (!onlyIds) showToast(`Already up to date: no loves to push to ${pluginName(service)}`);
      return;
    }

    loveBackfillRunningRef.current = { ...loveBackfillRunningRef.current, [service]: true };
    setLoveBackfillRunning(prev => ({ ...prev, [service]: true }));
    setLoveBackfillProgress(prev => ({ ...prev, [service]: { done: 0, total: todo.length } }));

    let pushed = 0, skipped = 0, failed = 0, removedMidRun = 0;
    for (let i = 0; i < todo.length; i++) {
      const track = todo[i];
      // The todo list is a snapshot: a track removed since the walk started
      // must not get its love pushed after the removal (parachord#1071 review).
      const stillThere = (collectionDataRef.current?.tracks || []).some((t) => t && t.id === track.id);
      if (!stillThere) { removedMidRun++; continue; }
      try {
        const result = await provider.loveTrack(track, providerConfig(service));
        if (!result || result.ok !== true) { skipped++; continue; }
        await markLovePushed(track.id, service, result.ref);
        clearLoveTombstone(result.ref);
        pushed++;
      } catch (err) {
        console.warn(`[love-backfill ${service}] failed for "${track.title}":`, err?.message || err);
        failed++;
      }
      setLoveBackfillProgress(prev => ({ ...prev, [service]: { done: i + 1, total: todo.length } }));
      // Soft rate-limit so we don't hammer the API
      await new Promise(r => setTimeout(r, 1000));
    }

    loveBackfillRunningRef.current = { ...loveBackfillRunningRef.current, [service]: false };
    setLoveBackfillRunning(prev => ({ ...prev, [service]: false }));
    setLoveBackfillProgress(prev => ({ ...prev, [service]: null }));

    const label = pluginName(service);
    let msg = `Backfilled ${pushed} love${pushed === 1 ? '' : 's'} to ${label}`;
    if (skipped > 0) msg += ` (${skipped} skipped: ${loves.needs === 'mbid' ? 'no MBID' : 'no match'})`;
    if (removedMidRun > 0) msg += ` (${removedMidRun} removed during the run)`;
    if (failed > 0) msg += ` (${failed} failed)`;
    showToast(msg);
  }, [showToast, markLovePushed]);

  // ── Loved-tracks IMPORT (parachord#1071) ──────────────────────────────
  // Pulls the user's loves from a scrobbler service into the collection —
  // the inbound half of the loved-tracks sync. Plan:
  // docs/plans/2026-11-06-import-loved-tracks.md. Rules:
  //   1. No loop: added AND matched rows are marked in love_pushed_keys for
  //      the service the loves came FROM, so the push toggle and the
  //      backfill never send a love straight back to its origin.
  //   2. Cross-service propagation is explicit AND confirmed: when the other
  //      service's push toggle is on and it's actually connected, a dialog
  //      says so up front; the imported ids then go to the other service
  //      through a RESTRICTED backfill (onlyIds), never a per-track live
  //      push (a resolver outage would flood the retry queue and hammer the
  //      mapper in parallel).
  //   3. Identity dedupe, not id: recording MBID, then the normalized name
  //      (planLoveImport). Last.fm's mbid is ignored (stale); non-Latin
  //      loves get trackSlug ids so 宇多田ヒカル/光 and 宇多田ヒカル/First Love
  //      are two rows, not one `--noalbum`.
  //   4. Tombstones: one provider ('love-import', name key) written on every
  //      removal and checked for both services, plus the recording-MBID
  //      entry. A love NEWER than the removal gets through, and a removal
  //      during the run is honored before each write.
  //   5. addedAt keeps the service's loved-at time.
  //   6. One-way stays one-way: importing never unloves anything remotely.

  const runLoveImport = React.useCallback(async (service) => {
    // A love provider that can list your loves (lib/love-providers.js, #1559).
    const declared = lovesFor(service);
    const provider = providerOf(service);
    if (!declared || !declared.canImport || typeof provider.getLovedPage !== 'function') return;
    if (loveImportRunningRef.current[service]) return;
    const label = pluginName(service);
    // The other love providers this import will also love on (step 2 below).
    const otherIds = [];
    let otherLabel = '';
    // A not-yet-loaded collection reads as empty: the dedupe would add
    // every love as new. Same guard class as saveCollection (#758).
    if (collectionLoadingRef.current) {
      showToast('Your Collection is still loading. Try the import again in a moment.', 'info');
      return;
    }
    // Take the running flag synchronously, before any await: a fast second
    // click must not pass the guard while the first run sits between awaits
    // (the updater re-check already prevents duplicate rows; this stops the
    // doubled counts).
    loveImportRunningRef.current = { ...loveImportRunningRef.current, [service]: true };
    setLoveImportRunning(prev => ({ ...prev, [service]: true }));
    setLoveImportProgress(prev => ({ ...prev, [service]: { done: 0, total: 0 } }));
    try {
      // Whose loves: the scrobbling sign-in's username, else the plug-in
      // account's. Both services publish a user's loves by username, so the
      // import needs no sign-in (it showed only while scrobbling was signed
      // in, and Last.fm's import went missing with it, 2026-11-23).
      // The provider says whose (#1559): Last.fm and ListenBrainz, the
      // username; a plug-in's own, its configured account.
      const username = await provider.importAccount({ scrobblerConfig: scrobblerConfigsRef.current?.[service], pluginConfig: metaServiceConfigsRef.current?.[service] });
      if (!username) { showToast(provider.importAccountHint(label), 'error'); return; }

      // Cross-service propagation, confirmed up front (issue #1071 rule 2):
      // every other love provider whose push is on (#1559: was "the other
      // one"). Connected, not just toggled — the dialog must not promise
      // pushes a disconnected service can't make. Cancel (the button or the
      // backdrop) stops the run.
      let crossConfirm = false;
      for (const id of loveProviderIds(loveServices())) {
        if (id === service || !scrobblerLovePushEnabledRef.current?.[id] || pausedBySync(id)) continue;
        let otherConnected = false;
        try { otherConnected = await providerOf(id).isSignedIn(); } catch (_e) { otherConnected = false; }
        if (otherConnected) otherIds.push(id);
      }
      otherLabel = andList(otherIds.map((id) => pluginName(id)));
      if (otherIds.length > 0) {
        setLoveImportProgress(prev => ({ ...prev, [service]: { done: 0, total: 0, phase: 'confirm' } }));
        const because = otherIds.length === 1 ? `"Push loves to ${otherLabel}" is on` : 'pushing loves is on for each of them';
        crossConfirm = await new Promise((resolve) => {
          showConfirmDialog({
            type: 'info',
            title: 'Import loved tracks',
            message: `Tracks you import from ${label} will also be loved on ${otherLabel}, because ${because}. This can't be undone from Parachord.`,
            confirmLabel: 'Import',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!crossConfirm) return;
      }

      const cursor = loveImportCursorRef.current?.[service] || 0; // loved-at seconds
      const setProgress = (done, total, phase) =>
        setLoveImportProgress(prev => ({ ...prev, [service]: { done, total, ...(phase ? { phase } : {}) } }));

      // 1. Fetch: only loves newer than the cursor (collectLoves owns the
      //    paging, the per-page retries and the stop rules).
      // The provider's pages (getLovedPage), each handed the last one's `next`.
      const { loves, skipped, complete, error, capped } = await LoveImport.collectLoves({
        fetchPage: ({ pageCursor }) => provider.getLovedPage({ cursor: pageCursor, account: username }, providerConfig(service)),
        parse: (page) => lovedPageForImport(page, service),
        cursor,
        pageSize: provider.pageSize || 200,
        onProgress: (done, total) => setProgress(done, total),
      });
      if (error && loves.length === 0 && skipped === 0) {
        if (error === 'Not connected') showToast(provider.importAccountHint(label), 'error');
        else showToast(`Couldn't import from ${label}: ${error}`, 'error');
        return;
      }
      if (loves.length === 0 && !error) {
        showToast(cursor > 0 ? `No new loved tracks on ${label}` : `No loved tracks found on ${label}`);
        return;
      }

      // 2. The tombstone list is load-bearing: importing without it could
      //    bring removed tracks back, so a failed read stops the run.
      let tombstones = {};
      try { tombstones = await window.electron.tombstones.list(); }
      catch (e) {
        showToast(`Couldn't read your removed-tracks list, so nothing was imported: ${e?.message || e}`, 'error');
        return;
      }

      const collectionTracks = collectionDataRef.current?.tracks || [];
      // Removals from before this feature shipped have no tombstone. A mark
      // in love_pushed_keys whose id is no longer in the collection was a
      // Parachord love the user later removed, so it counts as removed.
      const collectionIds = new Set(collectionTracks.map((t) => t && t.id).filter(Boolean));
      const orphanPushedIds = new Set(
        Object.keys(lovePushedKeysRef.current || {}).filter((id) => !collectionIds.has(id)));

      const dropRemoved = async (plan) => {
        // A removal during the run (the LB name-lookup tail can run for
        // minutes) must not be undone by this write — re-read and re-check.
        // A mid-run re-read failure falls back to the start-of-run snapshot;
        // the gating read in step 2 already stopped the run when the list
        // couldn't be read at all.
        let now = tombstones;
        try { now = await window.electron.tombstones.list(); } catch (_e) { /* keep the snapshot */ }
        // One predicate drives both the count and the filter, so the summary
        // can't drift from what was dropped. The pre-ship heuristic ONLY
        // applies where no tombstone entry exists at all: a removed-then-
        // re-loved track HAS one, and the date rule governs it.
        const removed = (row) => {
          const love = { service, artist: row.artist, title: row.title, mbid: row.mbid, lovedAt: row.addedAt / 1000 };
          if (LoveImport.isLoveTombstoned(now, love)) return true;
          return LoveImport.isOrphanedLovePush(orphanPushedIds, row) && LoveImport.loveTombstoneAt(now, love) == null;
        };
        plan.tombstoned += plan.add.filter(removed).length;
        plan.add = plan.add.filter((row) => !removed(row));
        return plan;
      };

      // 3. Plan and commit: rows with names land immediately; the
      //    metadata-less lookup tail commits as a second batch, so quitting
      //    during a long tail keeps the loves that never needed a lookup.
      // One batch per commit, each with its own updater flag and saves, so
      // a later batch can't read as confirmed off an earlier one's updater
      // run. A batch's marks are written when IT confirms (a quit during
      // the LB lookup tail must not leave batch 1 unmarked — Backfill would
      // re-offer those loves to the service they came from).
      const batches = [];
      const commitBatch = (plan) => {
        const batch = { planned: plan.add.length, updaterRan: false, savePromises: [], addedIds: [], saveOk: true };
        batches.push(batch);
        if (plan.add.length === 0) return batch;
        setCollectionData(prev => {
          batch.updaterRan = true;
          const prevIds = new Set(prev.tracks.map((t) => t && t.id).filter(Boolean));
          const fresh = plan.add.filter((r) => !prevIds.has(r.id));
          if (fresh.length === 0) return prev; // everything appeared concurrently; nothing to save
          const newData = { ...prev, tracks: [...prev.tracks, ...fresh] };
          batch.savePromises.push(saveCollection(newData));
          batch.addedIds.push(...fresh.map((r) => r.id));
          return newData;
        });
        return batch;
      };
      const writeMarks = async (ids) => {
        if (ids.length === 0) return;
        const marked = LoveImport.withLovesPushed(lovePushedKeysRef.current, ids, service);
        lovePushedKeysRef.current = marked;
        try { await window.electron.store.set('love_pushed_keys', marked); }
        catch (e) { console.warn(`[love-import ${service}] could not persist no-loop marks:`, e?.message || e); }
      };
      // Confirm a batch and mark its rows. Matched ids are already in the
      // collection, so their marks are safe whatever the save did; added ids
      // wait for THIS batch's confirmed save — a mark on a row a failed save
      // never wrote would, after a restart, read as "you removed this"
      // through the pre-ship heuristic and lose the love for good. A matched
      // id can name an earlier batch's planned-but-unsaved row (plan2 matches
      // plan1.add): marking that would orphan it the same way, so only ids
      // that were in the collection when the run started, or that an earlier
      // batch CONFIRMED, are marked. The setTimeout yield lets React commit
      // the updater before its save promises are read (MessageChannel
      // flushes ahead of timers).
      const confirmBatch = async (batch, matchedIds) => {
        const markableIds = new Set(collectionIds);
        for (const b of batches) {
          if (b === batch) break;
          if (b.saveOk) for (const id of b.addedIds) markableIds.add(id);
        }
        await writeMarks(matchedIds.filter((id) => markableIds.has(id)));
        await new Promise((r) => setTimeout(r, 0));
        if (batch.planned > 0) {
          if (!batch.updaterRan) batch.saveOk = false;
          else if (batch.savePromises.length > 0) batch.saveOk = (await Promise.all(batch.savePromises)).every(Boolean);
        }
        if (batch.saveOk) await writeMarks(batch.addedIds);
        return batch.saveOk;
      };

      // The MBIDs a heart's push resolved and stored on its mark (any
      // service's; ListenBrainz's today): indexed alongside the rows' own
      // MBIDs so a love for that MBID matches the hearted row instead of
      // duplicating it. Marks from before this shipped are plain timestamps
      // and contribute nothing.
      const markMbids = {};
      for (const [id, entry] of Object.entries(lovePushedKeysRef.current || {})) {
        const mbid = LoveImport.markedMbid(entry);
        if (mbid) markMbids[id] = mbid;
      }

      const namedLoves = loves.filter((l) => !l.needsLookup);
      const needsLookupLoves = loves.filter((l) => l.needsLookup);
      const plan1 = await dropRemoved(LoveImport.planLoveImport(namedLoves, collectionTracks, tombstones, markMbids));
      const batch1 = commitBatch(plan1);
      await confirmBatch(batch1, plan1.matchedIds);

      // 4. The lookup tail (ListenBrainz's metadata-less loves; none for
      //    Last.fm). One MB request each, on the background lane; a removed
      //    love is checked FIRST against the start-of-run snapshot (its MBID
      //    is all the tombstone key needs, so no 1.1s request is spent on a
      //    love that will drop, and a transient lookup failure can't hold
      //    the cursor for it; a removal DURING the run still costs one
      //    lookup before dropRemoved's re-read drops it at the write); a row
      //    already in the collection by MBID matches without the request; a
      //    transient MusicBrainz failure holds the cursor (the love isn't
      //    lost, just not this run) while a real miss is skipped.
      let lookupTransient = 0, lookupSkipped = 0, lookupRemoved = 0;
      const lookupMatchedIds = [];
      const resolvedLoves = [];
      if (needsLookupLoves.length > 0 && typeof window.lookupRecordingTitle === 'function') {
        const mbidIndex = LoveImport.rowMbidIndex([...collectionTracks, ...plan1.add], markMbids);
        setProgress(0, needsLookupLoves.length, 'lookup');
        for (let i = 0; i < needsLookupLoves.length; i++) {
          const cand = needsLookupLoves[i];
          if (LoveImport.isLoveTombstoned(tombstones, cand)) { lookupRemoved++; continue; }
          const existing = mbidIndex.get(cand.mbid);
          if (existing) { lookupMatchedIds.push(existing.id); }
          else {
            const result = await window.lookupRecordingTitle(cand.mbid);
            if (result?.status === 'ok') {
              resolvedLoves.push({ ...cand, artist: result.artist, title: result.title, album: result.album || '', mbid: result.mbid || cand.mbid, needsLookup: undefined });
            } else if (result?.status === 'transient') { lookupTransient++; }
            else { lookupSkipped++; }
          }
          setProgress(i + 1, needsLookupLoves.length, 'lookup');
        }
      } else if (needsLookupLoves.length > 0) {
        lookupSkipped += needsLookupLoves.length;
      }
      const plan2 = await dropRemoved(LoveImport.planLoveImport(resolvedLoves, [...collectionTracks, ...plan1.add], tombstones, markMbids));
      const batch2 = commitBatch(plan2);
      await confirmBatch(batch2, [...plan2.matchedIds, ...lookupMatchedIds]);

      // 5. Roll up the batches (each already confirmed and marked in
      //    confirmBatch above): the cursor moves only when every batch
      //    confirmed its write; the summary counts what actually landed; the
      //    cross-service push carries only the confirmed ids.
      const saveOk = batches.every((b) => b.saveOk);
      const plannedRows = batches.reduce((n, b) => n + b.planned, 0);
      const addedIds = batches.reduce((acc, b) => acc.concat(b.addedIds), []);
      const confirmedIds = batches.reduce((acc, b) => (b.saveOk ? acc.concat(b.addedIds) : acc), []);
      const anyUpdaterRan = batches.some((b) => b.updaterRan);
      const added = addedIds.length > 0 || plannedRows === 0 ? addedIds.length : (anyUpdaterRan ? addedIds.length : plannedRows);
      if (added > 0) showSidebarBadge('collection');
      // Two loves that match the same collection row are ONE mark but TWO
      // loves: the summary counts loves, so it adds up to what the service
      // returned.
      const matchedLoves = plan1.matchedIds.length + plan2.matchedIds.length + lookupMatchedIds.length;

      // 7. The cursor advances only when the whole window was read, nothing
      //    transient failed, and the save landed — otherwise the next run
      //    re-walks and self-heals instead of losing those loves forever.
      const nextCursor = (complete && saveOk && lookupTransient === 0)
        ? LoveImport.nextLoveCursor(cursor, loves, true)
        : cursor;
      if (nextCursor > cursor) {
        loveImportCursorRef.current = { ...(loveImportCursorRef.current || {}), [service]: nextCursor };
        window.electron.store.set('love_import_cursor', loveImportCursorRef.current).catch(() => {});
      }

      // 8. The summary. Rows the plan merged into one count as
      //    "already in your collection" — the summary must add up to what
      //    the service shows.
      const matched = matchedLoves + plan1.merged + plan2.merged;
      const tombstoned = plan1.tombstoned + plan2.tombstoned + lookupRemoved;
      const allSkipped = skipped + lookupSkipped;
      let msg = `Imported ${added} from ${label}. ${matched} already in your collection, ${allSkipped} skipped`;
      if (tombstoned > 0) msg += `, ${tombstoned} you removed`;
      if (capped) msg += '. Stopped at the import page cap, so older loves were left out';
      if (lookupTransient > 0) msg += `. Couldn't reach MusicBrainz for ${lookupTransient} of them; run the import again`;
      if (!saveOk) {
        // Without a restart the rows are already in memory, so a re-run
        // matches them and the confirmed cross-service push never fires —
        // say how to push them anyway.
        const otherSettings = otherIds.length === 1 ? `${otherLabel}'s settings` : `the settings of ${otherLabel}`;
        msg += `. Saving the library failed; run the import again after a restart${crossConfirm ? `, or send the imported loves from ${otherSettings}` : ''}`;
      }
      if (!complete && error) {
        showToast(`Imported ${added} from ${label}, then stopped: ${error}. Run it again to pick up the rest.`, 'error', null, { duration: 8000 });
      } else {
        showToast(msg, saveOk ? 'success' : 'error', null, { duration: 8000 });
      }

      // 9. Cross-service propagation, confirmed in the pre-run dialog: just
      //    the imported ids, through the restricted backfill (its own
      //    progress on the other card), never a per-track live push.
      if (crossConfirm && confirmedIds.length > 0) {
        for (const otherId of otherIds) {
          const otherName = pluginName(otherId);
          // The restricted backfill is a no-op while that service's own
          // backfill is running — say so instead of silently skipping the
          // confirmed push.
          if (loveBackfillRunningRef.current[otherId]) {
            showToast(`A ${otherName} backfill is still running. Once it finishes, send the ${countOf(confirmedIds.length, 'imported love')} from ${otherName}'s settings.`, 'info');
          } else {
            runLoveBackfill(otherId, { onlyIds: new Set(confirmedIds) }).catch((err) => {
              console.warn(`[love-import ${service}] cross-service push failed:`, err?.message || err);
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[love-import ${service}] failed:`, err?.message || err);
      showToast(`Couldn't import from ${label}: ${err?.message || err}`, 'error');
    } finally {
      loveImportRunningRef.current = { ...loveImportRunningRef.current, [service]: false };
      setLoveImportRunning(prev => ({ ...prev, [service]: false }));
      setLoveImportProgress(prev => ({ ...prev, [service]: null }));
    }
  }, [showToast, showSidebarBadge, showConfirmDialog, saveCollection, runLoveBackfill]);

  return {
    scrobblerLovePushEnabled, setScrobblerLovePushEnabled,
    lovePushedKeysRef, loveImportCursorRef, loveRetryQueueRef,
    loveBackfillRunning, loveBackfillProgress,
    loveImportRunning, loveImportProgress,
    pushLoveToScrobblers, setLovePushEnabled, runLoveBackfill, runLoveImport,
  };
}

module.exports = { useLoves };
