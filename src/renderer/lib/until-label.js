// src/renderer/lib/until-label.js: when something ends, as people say it:
// "4:05 PM" today, "4:05 PM tomorrow", else "4:05 PM on Thu". Time first, so
// it reads after both "until" and "at".
// The Sync menu's "Paused until …" for a service's rate-limit cooldown (#909).
// Pure; `now` is injectable for tests. Loads under plain Node.

function untilLabel(until, now = Date.now()) {
  const end = new Date(Number(until));
  if (!Number.isFinite(end.getTime())) return '';
  const time = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date(now);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(end) - startOf(today)) / 86400000);
  if (days <= 0) return time;
  if (days === 1) return `${time} tomorrow`;
  return `${time} on ${end.toLocaleDateString([], { weekday: 'short' })}`;
}

module.exports = { untilLabel };
