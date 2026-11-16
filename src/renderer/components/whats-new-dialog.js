// src/renderer/components/whats-new-dialog.js: the What's New dialog.
//
// Shows the highlights main.js parses from the release notes (each "##" /
// "###" heading with its first bullet or paragraph) on the shared Modal.
// It used to be its own orange-gradient shell with hard-coded amber tiles
// that stayed pale in dark mode, an 18px title-case title, and six pasted
// SVGs handed out in turn, so "Faster search" got a star and "Album art" a
// link. Each highlight's icon now comes from its heading (whatsNewIcon),
// from the shared icon set.
//
// Props: open, onClose, version, highlights [{ title, text }], onFullNotes.
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { PAGE_ICONS } = require('../lib/page-icons');
const { Button } = require('./button');

const MAX_HIGHLIGHTS = 6;

// First match wins, so the specific nouns come before the general ones
// ("Faster search" is a search note and "Faster artist pages" an artist
// one; speed is the fallback).
const ICON_RULES = [
  [/sync|import/, 'RefreshCw'],
  [/search/, PAGE_ICONS.search],
  [/friend|listen.?along/, 'Users'],
  [/concert|tour|ticket/, PAGE_ICONS.concerts],
  [/love|heart/, 'Heart'],
  [/playlist/, PAGE_ICONS.playlists],
  [/library|collection|local files?/, PAGE_ICONS.library],
  [/fresh drops/, PAGE_ICONS['new-releases']],
  [/critical darlings|critics/, PAGE_ICONS['critics-picks']],
  [/pop of the tops|charts?/, PAGE_ICONS.discover],
  [/recommend|discover/, PAGE_ICONS.recommendations],
  [/radio/, 'Radio'],
  [/shuffleupagus|\bai\b|\bdj\b/, 'Zap'],
  [/link|share|deep link/, 'Link'],
  [/setting|plug-?ins?|preferences/, PAGE_ICONS.settings],
  [/^home\b/, PAGE_ICONS.home],
  [/playback|player|queue|volume/, 'Play'],
  [/download|offline/, 'Download'],
  [/scrobbl|history/, PAGE_ICONS.history],
  [/\b(art|cover|album|artist|music|spotify|apple|amazon|bandcamp|soundcloud|youtube|tidal)/, 'Music'],
  [/fast|speed|startup|performance/, 'Zap'],
];

function whatsNewIcon(title) {
  const t = String(title || '').toLowerCase();
  for (const [re, name] of ICON_RULES) if (re.test(t)) return name;
  return 'Star';
}

function WhatsNewDialog({ open, onClose, version, highlights, onFullNotes }) {
  const e = React.createElement;
  if (!open) return null;
  const all = (highlights && highlights.length > 0) ? highlights : [];
  const shown = all.slice(0, MAX_HIGHLIGHTS);
  const hidden = all.length - shown.length;
  return e(Modal, {
    open, onClose, size: 'md',
    title: 'What’s new',
    description: version ? `Version ${version}` : null,
    footer: [
      e(Button, { key: 'notes', variant: 'secondary', onClick: onFullNotes }, 'Full release notes'),
      e(Button, { key: 'done', variant: 'primary', onClick: onClose }, 'Done'),
    ],
  },
    shown.length === 0
      ? e('p', { className: 'text-ink-secondary', style: { fontSize: '14px', lineHeight: 1.5, marginTop: '12px' } },
        'See what changed in this version in the full release notes.')
      : e('ul', { style: { listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' } },
        shown.map((h, i) => {
          const Icon = Icons[whatsNewIcon(h.title)] || Icons.Star;
          return e('li', { key: `${i}-${h.title}`, className: 'flex items-start', style: { gap: '12px' } },
            e('span', {
              className: 'flex items-center justify-center flex-shrink-0',
              style: { width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' },
            }, e(Icon, { size: 16 })),
            e('div', { className: 'min-w-0', style: { flex: 1 } },
              e('h3', { className: 'text-ink-primary', style: { fontSize: '14px', fontWeight: 600, margin: '0 0 4px', lineHeight: 1.4 } }, h.title),
              e('p', { className: 'text-ink-secondary', style: { fontSize: '13px', lineHeight: 1.5, margin: 0, userSelect: 'text' } }, h.text)));
        })),
    hidden > 0 && e('p', { className: 'text-ink-tertiary', style: { fontSize: '13px', margin: '16px 0 0' } },
      `And ${hidden} more in the full release notes.`)
  );
}

module.exports = { WhatsNewDialog, whatsNewIcon, MAX_HIGHLIGHTS };
