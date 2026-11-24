// src/renderer/lib/weekly-saved-name.js: the name a saved weekly playlist
// gets (#1599): its kind and its week's date, "Weekly Exploration · Nov 17,
// 2026".
//
// The copy used to be "Weekly Jam - <weekLabel>": the kind was hard-coded
// (a saved Weekly Exploration was a "Weekly Jam" too), and the week label is
// relative ("This Week"), so every week saved on its Monday had the same
// name. Sync matches playlists by name, so two weeks' copies, or a playlist
// of that name on a service, could be linked to the same remote one, and a
// push overwrote the wrong playlist. A week with no date takes the day it was
// saved; never the relative label.
//
// Mobile's rule (weeklySavedName in parachord-mobile's
// WeeklyPlaylistHeader.kt, #763), in the same words, so a week saved on
// either is named the same. Pure, loads under plain Node.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The kind when the playlist has no title of its own.
const WEEKLY_PLAYLIST_LABEL = 'Weekly playlist';

// An ISO date (optionally with a time) as "Nov 17, 2026": its calendar day as
// written, with no time-zone shift. Empty for blank or unparseable input.
function weeklyDateLabel(raw) {
  if (typeof raw !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

// Today's local calendar day as YYYY-MM-DD.
function todayIsoDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// The saved copy's name for a weekly playlist ({ title, date }).
function weeklySavedName(playlist, now = new Date()) {
  const label = String((playlist && playlist.title) || '').trim() || WEEKLY_PLAYLIST_LABEL;
  const stamp = weeklyDateLabel(playlist && playlist.date) || weeklyDateLabel(todayIsoDate(now));
  return `${label} · ${stamp}`;
}

module.exports = { weeklySavedName, weeklyDateLabel, todayIsoDate, WEEKLY_PLAYLIST_LABEL };
