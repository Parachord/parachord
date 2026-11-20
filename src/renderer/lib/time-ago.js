// src/renderer/lib/time-ago.js: one relative-time phrase for the app
// (#1388): "just now", "18m ago", "3h ago", "5d ago", "2mo ago", "1y ago".
// Home's playlist rows and History's listen times used their own copies.
// Plain module; loads under plain Node.

function timeAgo(at, now = Date.now()) {
  const diff = Math.max(0, now - at);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  // Months until a full year has passed: 360 to 364 days are twelve 30-day
  // months but zero years, and read "12mo ago", not "0y ago" (#1569).
  if (mo < 12 || d < 365) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

module.exports = { timeAgo };
