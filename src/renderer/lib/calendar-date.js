// src/renderer/lib/calendar-date.js: show a calendar date as written.
//
// MusicBrainz (and most catalogs) give release and founding dates as calendar
// dates: "2026-11-06", "2026-11" or "2026". new Date("2026-11-06") reads that
// as midnight UTC, which is the evening before anywhere west of UTC, so a
// November 6 release showed as "November 5, 2026" (#1288). A year-only date
// was worse: "2026" became December 31, 2025. This builds the date from its
// parts in local time, so the day shown is the day written.
//
// style: 'long' ("November 6, 2026", "November 2026") or 'short'
// ("Nov 6, 2026", "Nov 2026"). A year alone is just the year. Anything that
// isn't one of those shapes, or isn't a real date, is shown as given.

'use strict';

const CALENDAR = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function formatCalendarDate(value, style = 'long', fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).trim();
  const match = CALENDAR.exec(text);
  if (!match) return text;

  const [, y, m, d] = match;
  const year = Number(y);
  if (!m) return y;

  const month = Number(m);
  const day = d ? Number(d) : 1;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return text;

  const monthStyle = style === 'short' ? 'short' : 'long';
  return d
    ? date.toLocaleDateString('en-US', { year: 'numeric', month: monthStyle, day: 'numeric' })
    : date.toLocaleDateString('en-US', { year: 'numeric', month: monthStyle });
}

module.exports = { formatCalendarDate };
