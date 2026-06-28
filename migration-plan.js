// Pure shaping for the legacy → N-way migration preview (parachord#911).
// Consumes the shadow reconcile output ({ results, cycles, errors }, where each
// result already carries displayName + a named per-target diff) and produces:
//   1. summarizeMigrationPlan — the render model for the preview modal.
//   2. buildMigrationReport   — a GitHub-issue title/body/url for "Report a problem".
// No I/O, no DOM. Loaded via a <script> tag for the renderer (attaches to window)
// and required directly by jest. See docs/plans/2026-06-28-legacy-to-nway-sync-migration.md.

function trackLabel(t) {
  const artist = (t && t.artist) || '';
  const title = (t && t.title) || '';
  if (artist && title) return `${artist} — ${title}`;
  return title || artist || 'Unknown track';
}

// Shadow output → render model. NOOP playlists aren't in `results` (the reconcile
// core returns null for them and the driver drops nulls), so noopCount is derived
// from the cycle count. 'would-push' with an empty effective diff is also a noop.
function summarizeMigrationPlan(shadowOutput) {
  const out = shadowOutput || {};
  const results = Array.isArray(out.results) ? out.results : [];
  const cycles = typeof out.cycles === 'number' ? out.cycles : results.length;
  const errors = Array.isArray(out.errors) ? out.errors : [];

  const changed = [];
  const protectedList = [];
  let totalAdds = 0;
  let totalRemoves = 0;

  for (const r of results) {
    if (!r) continue;
    if (r.status === 'would-push') {
      const providers = (r.perTarget || [])
        .map((t) => ({
          providerId: t.providerId,
          adds: Array.isArray(t.addTracks) ? t.addTracks : [],
          removes: Array.isArray(t.removeTracks) ? t.removeTracks : [],
        }))
        .filter((p) => p.adds.length || p.removes.length);
      if (providers.length) {
        for (const p of providers) { totalAdds += p.adds.length; totalRemoves += p.removes.length; }
        changed.push({ localId: r.localId, displayName: r.displayName || r.localId, providers });
      }
    } else if (r.status === 'total-wipe-abort') {
      protectedList.push({ localId: r.localId, displayName: r.displayName || r.localId, reason: 'total-wipe' });
    } else if (r.status === 'partial-abort') {
      protectedList.push({ localId: r.localId, displayName: r.displayName || r.localId, reason: 'partial' });
    }
  }

  const accountedNonNoop = results.length;
  return {
    changed,
    protected: protectedList,
    noopCount: Math.max(0, cycles - accountedNonNoop),
    totalAdds,
    totalRemoves,
    hasRemoves: totalRemoves > 0,
    hasChanges: changed.length > 0,
    errorCount: errors.length,
    cycles,
  };
}

// Render model → a prefilled GitHub issue. The renderer ALSO copies `body` to the
// clipboard before opening `githubUrl`, because GitHub truncates very long
// prefilled bodies in the URL — the clipboard copy is the complete record.
function buildMigrationReport(summary, opts) {
  const s = summary || {};
  const o = opts || {};
  const appVersion = o.appVersion || 'unknown';
  const lines = [];
  lines.push('The new-sync preview showed a diff that looks wrong. Reporting it instead of accepting (parachord#911).');
  lines.push('');
  lines.push('## What looks wrong');
  lines.push('<!-- e.g. these tracks should not be removed — tell us what is off -->');
  lines.push('');
  lines.push('## Preview diff');
  lines.push(`- App version: ${appVersion}`);
  lines.push(`- Playlists with changes: ${s.changed ? s.changed.length : 0}`);
  lines.push(`- Would add: ${s.totalAdds || 0} track(s)`);
  lines.push(`- Would remove: ${s.totalRemoves || 0} track(s)`);
  if (s.protected && s.protected.length) lines.push(`- Safety aborts: ${s.protected.length}`);
  lines.push('');
  for (const pl of (s.changed || [])) {
    lines.push(`### ${pl.displayName}`);
    for (const p of pl.providers) {
      for (const t of p.removes) lines.push(`- remove · ${p.providerId} · ${trackLabel(t)}`);
      for (const t of p.adds) lines.push(`- add · ${p.providerId} · ${trackLabel(t)}`);
    }
    lines.push('');
  }
  const body = lines.join('\n');
  const title = `New sync preview looks wrong (${s.totalRemoves || 0} remove(s), v${appVersion})`;
  const githubUrl = 'https://github.com/Parachord/parachord/issues/new'
    + `?title=${encodeURIComponent(title)}`
    + `&body=${encodeURIComponent(body)}`
    + `&labels=${encodeURIComponent('sync')}`;
  return { title, body, githubUrl };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { summarizeMigrationPlan, buildMigrationReport, trackLabel };
} else if (typeof window !== 'undefined') {
  window.summarizeMigrationPlan = summarizeMigrationPlan;
  window.buildMigrationReport = buildMigrationReport;
}
