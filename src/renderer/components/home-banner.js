// src/renderer/components/home-banner.js: the one banner slot at the top of
// Home. It shows items[0] (backend-pushed announcements only; see
// lib/home-banners.js) and nothing when the list is empty. Dismissing the
// shown item makes the parent drop it, so the next one takes the slot.
//
// Props-driven; loads under plain Node (no window at module scope).

const { Button } = require('./button');
const Icons = require('./icons');
const { BANNER_SEVERITY_COLORS } = require('../lib/home-banners');

function HomeBanner({ items, onDismiss, onCta }) {
  const item = Array.isArray(items) ? items[0] : null;
  if (!item) return null;

  const bg = BANNER_SEVERITY_COLORS[item.severity] || BANNER_SEVERITY_COLORS.info;

  // iconUrl (https only) first, then the glyph. A broken image hides itself.
  const iconUrlOk = typeof item.iconUrl === 'string' && /^https:\/\//i.test(item.iconUrl);
  const iconText = typeof item.icon === 'string' && item.icon.length > 0 && item.icon.length <= 4 ? item.icon : null;
  const iconNode = iconUrlOk
    ? React.createElement('img', {
        src: item.iconUrl,
        alt: '',
        referrerPolicy: 'no-referrer',
        onError: (e) => { try { e.currentTarget.style.display = 'none'; } catch (_) {} },
        style: { width: '20px', height: '20px', flexShrink: 0, marginTop: '1px', borderRadius: '4px', objectFit: 'cover' }
      })
    : iconText
      ? React.createElement('div', {
          style: { fontSize: '16px', lineHeight: '20px', flexShrink: 0, marginTop: '1px' }
        }, iconText)
      : null;

  const ctaOk = item.cta && typeof item.cta.url === 'string' && /^https?:\/\//i.test(item.cta.url);
  const ctaLabel = item.cta && item.cta.label;

  return React.createElement('div', {
    key: item.id,
    className: 'flex items-start gap-3 px-4 py-2.5 flex-shrink-0',
    style: {
      backgroundColor: bg,
      color: 'var(--on-accent)', // white text on a coloured fill, like the plug-in headers
      fontSize: '13px'
    }
  },
    iconNode,
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('div', { style: { fontWeight: 600 } }, item.title),
      item.body && React.createElement('div', { style: { color: 'var(--on-color-secondary)', marginTop: '2px' } }, item.body)
    ),
    ctaOk && React.createElement(Button, { variant: 'secondary', size: 'sm', tone: 'dark', onClick: () => onCta && onCta(item) }, ctaLabel),
    React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', onClick: () => onDismiss && onDismiss(item), 'aria-label': 'Dismiss announcement', 'data-tooltip': 'Dismiss' }, React.createElement(Icons.X, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }))
  );
}

module.exports = { HomeBanner };
