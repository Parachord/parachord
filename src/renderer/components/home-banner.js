// src/renderer/components/home-banner.js — the one banner slot at the top of
// Home. It shows items[0] (What's New first, then remote announcements; see
// lib/home-banners.js) and nothing when the list is empty. Dismissing the
// shown item makes the parent drop it, so the next one takes the slot.
//
// Props-driven; loads under plain Node (no window at module scope).

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

  // A What's New item has no URL: its button opens the modal.
  const isWhatsNew = item.kind === 'whats-new';
  const ctaOk = isWhatsNew || (item.cta && typeof item.cta.url === 'string' && /^https?:\/\//i.test(item.cta.url));
  const ctaLabel = isWhatsNew ? "See what's new" : (item.cta && item.cta.label);

  return React.createElement('div', {
    key: item.id,
    className: 'flex items-start gap-3 px-4 py-2.5 flex-shrink-0',
    style: {
      backgroundColor: bg,
      color: '#ffffff', // on-color
      fontSize: '13px'
    }
  },
    iconNode,
    React.createElement('div', { className: 'flex-1 min-w-0' },
      React.createElement('div', { style: { fontWeight: 600 } }, item.title),
      item.body && React.createElement('div', { style: { opacity: 0.9, marginTop: '2px' } }, item.body)
    ),
    ctaOk && React.createElement('button', {
      onClick: () => onCta && onCta(item),
      style: {
        padding: '4px 12px',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        border: '1px solid rgba(255, 255, 255, 0.35)',
        borderRadius: '6px',
        color: '#ffffff', // on-color
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }
    }, ctaLabel),
    React.createElement('button', {
      onClick: () => onDismiss && onDismiss(item),
      'aria-label': 'Dismiss announcement',
      title: 'Dismiss',
      style: {
        background: 'transparent',
        border: 'none',
        color: '#ffffff', // on-color
        opacity: 0.85,
        cursor: 'pointer',
        padding: '0 4px',
        fontSize: '18px',
        lineHeight: 1,
        flexShrink: 0
      }
    }, '×')
  );
}

module.exports = { HomeBanner };
