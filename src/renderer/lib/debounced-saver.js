/**
 * A save that runs a while after the last change, and no later than a set
 * time after the first unsaved one.
 *
 * Built for the track-sources cache (cache_track_sources): before it, that
 * cache reached disk only on the 5-minute timer, so tracks resolved in a
 * shorter session were resolved again on every launch
 * (docs/architecture/state-persistence.md, "Save Triggers"). A save of it
 * clones ~10 MB over IPC and rewrites the file (~140 ms in all at 6,000
 * entries), so it must not run per resolution:
 *   - markDirty() after each change; the save runs delayMs after the last
 *     one (a burst of resolutions is one save),
 *   - but never later than maxWaitMs after the first unsaved change (a page
 *     that keeps resolving still gets saved),
 *   - and only once canSave() says so (the track sources must have loaded
 *     from disk first, or the save would overwrite the file with the few
 *     entries resolved so far). A refused save stays pending and retries.
 *
 * Plain module, no app state: everything comes in through the options, so it
 * runs under Node and jest with fake timers.
 */

function createDebouncedSaver({
  save,
  delayMs,
  maxWaitMs,
  canSave = () => true,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
  onError = () => {}
} = {}) {
  if (typeof save !== 'function') throw new Error('createDebouncedSaver: save is required');
  let dirty = false;
  let firstDirtyAt = 0;
  let timer = null;
  let saving = false;

  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    const untilMax = Math.max(0, firstDirtyAt + maxWaitMs - now());
    timer = setTimer(run, Math.min(delayMs, untilMax));
  };

  const run = async () => {
    timer = null;
    if (!dirty) return;
    if (saving || !canSave()) {
      // Not now: try again after another delay (the max-wait is already due).
      timer = setTimer(run, delayMs);
      return;
    }
    dirty = false;
    saving = true;
    try {
      await save();
    } catch (e) {
      // The changes are still unsaved: keep them pending.
      if (!dirty) { dirty = true; firstDirtyAt = now(); }
      onError(e);
    } finally {
      saving = false;
    }
    if (dirty && timer === null) schedule();
  };

  return {
    markDirty() {
      if (!dirty) { dirty = true; firstDirtyAt = now(); }
      schedule();
    },
    // Save now if anything is pending (and allowed); resolves when done.
    async flush() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      await run();
    },
    cancel() {
      if (timer !== null) { clearTimer(timer); timer = null; }
      dirty = false;
    },
    isDirty: () => dirty
  };
}

const api = { createDebouncedSaver };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof globalThis !== 'undefined') globalThis.createDebouncedSaver = createDebouncedSaver;
