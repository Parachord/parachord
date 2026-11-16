// src/renderer/components/nway-migration-dialog.js: the one-time sync migration review
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (NWAY_MIGRATION_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { Button } = require('./button');

const NWAY_MIGRATION_DIALOG_HANDLERS = [
  'acceptNwayMigration',
  'reportNwayMigration',
];

const NwayMigrationDialog = React.memo(function NwayMigrationDialog(props) {
  const {
    acceptNwayMigration,
    nwayMigrationDialog,
    reportNwayMigration,
    setNwayMigrationDialog,
  } = props;
  return React.createElement(Modal, {
      size: 'lg',
      title: 'Switch to new sync on this device?',
      description: React.createElement(React.Fragment, null,
        'We ran the ',
        React.createElement('a', {
          href: '#',
          onClick: (e) => { e.preventDefault(); if (window.electron?.shell?.openExternal) window.electron.shell.openExternal('https://parachord.com/blog/2026/06/25/keeping-playlists-in-sync/'); },
          className: 'text-accent font-medium hover:underline'
        }, 'new sync'),
        ' against your library without writing anything. Here’s exactly what it would change.'
      ),
      dismissible: !nwayMigrationDialog.loading,
      onClose: () => { if (!nwayMigrationDialog.loading) setNwayMigrationDialog({ show: false }); },
      footer: [
        React.createElement('span', { key: 'note', className: 'text-ink-tertiary', style: { fontSize: '11px', marginRight: 'auto' } }, 'Disables the old sync here. Reversible anytime.'),
        React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: () => setNwayMigrationDialog({ show: false }) }, 'Cancel'),
        (nwayMigrationDialog.summary && (nwayMigrationDialog.summary.hasChanges || nwayMigrationDialog.summary.protected.length)) &&
          React.createElement(Button, { key: 'report', variant: 'secondary', onClick: () => reportNwayMigration() }, 'Report a problem'),
        React.createElement(Button, {
          key: 'accept', variant: 'primary', onClick: () => acceptNwayMigration(),
          disabled: nwayMigrationDialog.loading || !nwayMigrationDialog.summary
        }, (nwayMigrationDialog.summary && !nwayMigrationDialog.summary.hasChanges) ? 'Switch' : 'Accept changes and switch')
      ].filter(Boolean)
    },
React.createElement('div', { style: { marginTop: '12px' } },
          (() => {
            const d = nwayMigrationDialog;
            if (d.loading) return React.createElement('div', { style: { padding: '30px 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' } },
              React.createElement(Icons.Spinner, { style: { color: 'var(--accent-primary)' } }),
              React.createElement('p', { style: { fontSize: '13px', color: 'var(--text-secondary)', margin: 0 } }, 'Checking your playlists…')
            );
            if (d.error) return React.createElement('p', { style: { padding: '8px 0 16px', fontSize: '13px', color: 'var(--text-danger)' } }, `Couldn't run the preview: ${d.error}`);
            const s = d.summary;
            if (!s) return null;
            const banner = (bg, border, color, text) => React.createElement('div', { style: { backgroundColor: bg, border: `1px solid ${border}`, borderRadius: '8px', padding: '9px 11px', marginBottom: '12px' } }, React.createElement('span', { style: { fontSize: '12px', color, lineHeight: '1.45' } }, text));
            const rows = [];
            if (d.recomputed) rows.push(banner('var(--tint-warning)', 'var(--border-warning)', 'var(--text-warning)', 'The remote changed since you opened this. This is the updated diff.'));
            if (s.hasRemoves) rows.push(banner('var(--tint-danger)', 'var(--border-danger)', 'var(--text-danger)', `${s.totalRemoves} track${s.totalRemoves === 1 ? '' : 's'} would be removed. Review the removals before you accept.`));
            if (!s.hasChanges && !s.protected.length) {
              rows.push(React.createElement('p', { key: 'noop', style: { fontSize: '13px', color: 'var(--text-secondary)', padding: '4px 0 14px' } }, 'Your playlists are already in sync, so nothing changes. Safe to switch.'));
            } else if (s.hasChanges) {
              rows.push(React.createElement('p', { key: 'sum', style: { fontSize: '12px', color: 'var(--text-tertiary)', padding: '2px 0 8px' } }, `${s.noopCount} playlist${s.noopCount === 1 ? '' : 's'} already match. ${s.changed.length} need${s.changed.length === 1 ? 's' : ''} changes:`));
            }
            s.changed.forEach((pl, pi) => {
              const hasRem = pl.providers.some((p) => p.removes.length);
              const provNodes = [];
              pl.providers.forEach((p, ppi) => {
                provNodes.push(React.createElement('div', { key: `h${ppi}`, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: ppi ? '8px' : '6px' } },
                  React.createElement('span', { style: { fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' } }, p.providerId),
                  React.createElement('span', { style: { fontSize: '11px', color: 'var(--text-tertiary)' } }, `${p.adds.length ? '+' + p.adds.length : ''}${p.adds.length && p.removes.length ? ' · ' : ''}${p.removes.length ? '−' + p.removes.length : ''}`)
                ));
                p.removes.forEach((t, ti) => provNodes.push(React.createElement('div', { key: `r${ppi}-${ti}`, style: { fontSize: '13px', color: 'var(--text-danger)', padding: '2px 0' } }, `−  ${t.artist}${t.artist && t.title ? ' — ' : ''}${t.title}`)));
                p.adds.forEach((t, ti) => provNodes.push(React.createElement('div', { key: `a${ppi}-${ti}`, style: { fontSize: '13px', color: 'var(--text-success)', padding: '2px 0' } }, `+  ${t.artist}${t.artist && t.title ? ' — ' : ''}${t.title}`)));
              });
              rows.push(React.createElement('div', { key: `pl${pi}`, style: { padding: '10px 12px', marginBottom: '8px', borderRadius: '10px', backgroundColor: hasRem ? 'var(--tint-danger)' : 'var(--hover-bg-default)', borderLeft: hasRem ? '3px solid var(--fill-error)' : '3px solid transparent' } },
                React.createElement('div', { style: { fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' } }, pl.displayName),
                ...provNodes
              ));
            });
            s.protected.forEach((pp, pi) => {
              rows.push(React.createElement('div', { key: `prot${pi}`, style: { padding: '8px 12px', marginBottom: '8px' } },
                React.createElement('div', { style: { fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' } }, `${pp.displayName} — protected`),
                React.createElement('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.45' } }, pp.reason === 'total-wipe' ? "New sync declined a full-replace it couldn't verify, and left it untouched. Your tracks are safe." : 'New sync skipped an unverifiable change and left it untouched.')
              ));
            });
            // Cross-device nudge (parachord#946, parity with mobile). `sync_engine_mode`
            // is per-client with no account-level coordinator, so flipping one device
            // but not the others leaves the user in mixed mode on shared remotes until
            // all match. Shown in every summary case (changes, no-changes, protected),
            // before Accept.
            rows.push(React.createElement('div', { key: 'xdevice', style: { marginTop: '8px', padding: '9px 11px', borderRadius: '8px', backgroundColor: 'var(--accent-primary-alpha-06)', border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)' } },
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.45' } },
                'Using Parachord on another device (mobile, etc.)? Switch it to new sync too — running the old and new engines on the same playlists can churn them until all your devices match.')
            ));
            return React.createElement('div', { style: { paddingBottom: '8px' } }, ...rows);
          })()
        )
    );
});

module.exports = { NwayMigrationDialog, NWAY_MIGRATION_DIALOG_HANDLERS };
