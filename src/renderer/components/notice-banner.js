// src/renderer/components/notice-banner.js: the playlist page's notice banner,
// a tinted card with an icon, a line in bold, a line under it and actions on
// the right. The sync banner ("You changed this playlist", a conflict) and the
// duplicates banner (#1635) use it; it was the sync banner's own markup.
//
// tone picks the status colour (both themes): 'success', 'warning' or 'info'.
// Props-driven; loads under plain Node.

const TONE_TOKENS = { success: '--success', warning: '--warning', info: '--info' };
const TONE_TEXT = { success: 'text-ink-success', warning: 'text-ink-warning', info: 'text-ink-info' };

function NoticeBanner({ tone = 'info', icon, title, text, actions }) {
  const token = TONE_TOKENS[tone] || TONE_TOKENS.info;
  const tint = (pct) => `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
  const bg = tint(12);
  return React.createElement('div', {
    className: 'mx-4 mb-4 overflow-hidden rounded-lg',
    style: { background: `linear-gradient(135deg, ${bg} 0%, ${bg} 100%)`, border: `1px solid ${tint(25)}`, boxShadow: `0 2px 8px ${bg}` }
  },
    React.createElement('div', { className: 'flex items-center justify-between px-4 py-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        icon && React.createElement('div', {
          className: 'flex items-center justify-center w-8 h-8 rounded-full',
          style: { background: tint(20) }
        }, React.createElement(icon, { size: 16, className: TONE_TEXT[tone] || TONE_TEXT.info })),
        React.createElement('div', { className: 'flex flex-col' },
          React.createElement('span', { className: 'text-ink-primary', style: { fontSize: '13px', fontWeight: 600 } }, title),
          text && React.createElement('span', { className: 'text-ink-secondary', style: { fontSize: '13px' } }, text))
      ),
      actions && React.createElement('div', { className: 'flex items-center gap-2' }, actions)
    )
  );
}

module.exports = { NoticeBanner };
