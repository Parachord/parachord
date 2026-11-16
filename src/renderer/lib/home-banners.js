// Banner list model for the Home page. `announcements` arrives already
// filtered (expiry, version range, dismissals), so this only orders and
// normalises, keeping their given order. The slot is only for announcements
// created on the backend; release notes live in the setup element.

// The fills, index.html's --fill-* tokens: the same in both themes, each at
// least 4.5:1 with white text (tests/renderer/home-banners.test.js reads the
// values there).
const BANNER_SEVERITY_COLORS = {
  info: 'var(--fill-info)',
  success: 'var(--fill-success)',
  warn: 'var(--fill-warning)',
  error: 'var(--fill-error)',
};

function homeBannerItems({ announcements } = {}) {
  const items = [];
  for (const a of announcements || []) {
    items.push({
      id: a.id,
      kind: 'announcement',
      title: a.title,
      body: a.body,
      icon: a.icon || null,
      iconUrl: a.iconUrl || null,
      cta: a.cta || null,
      severity: a.severity || 'info',
    });
  }
  return items;
}

// The id that earns a `view` event: only when the banner Home paints (the
// first item) is a remote announcement. One queued behind it has not been seen.
function bannerViewId(items) {
  const top = Array.isArray(items) ? items[0] : null;
  return top && top.kind === 'announcement' && top.id ? top.id : null;
}

module.exports = { homeBannerItems, bannerViewId, BANNER_SEVERITY_COLORS };
