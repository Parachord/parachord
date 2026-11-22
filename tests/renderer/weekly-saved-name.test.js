/**
 * #1599: a saved weekly playlist is named by its kind and its week's date
 * ("Weekly Exploration · Nov 17, 2026"), never "Weekly Jam - This Week":
 * the kind was hard-coded and the relative week label repeated every week,
 * so two weeks' copies (or a playlist of that name on a service) could be
 * matched by name on sync. Mobile's rule (weeklySavedName,
 * parachord-mobile#763), in the same words.
 */
const fs = require('fs');
const path = require('path');
const { weeklySavedName, weeklyDateLabel, todayIsoDate } = require('../../src/renderer/lib/weekly-saved-name');

describe('weeklyDateLabel', () => {
  test('an ISO date, with or without a time, reads as its calendar day, with no time-zone shift', () => {
    expect(weeklyDateLabel('2026-11-17')).toBe('Nov 17, 2026');
    expect(weeklyDateLabel('2026-11-17T00:00:00+00:00')).toBe('Nov 17, 2026');
    expect(weeklyDateLabel('2026-01-05T23:59:59.000Z')).toBe('Jan 5, 2026');
  });

  test('blank or unparseable is empty', () => {
    expect(weeklyDateLabel('')).toBe('');
    expect(weeklyDateLabel(null)).toBe('');
    expect(weeklyDateLabel('This Week')).toBe('');
    expect(weeklyDateLabel('2026-13-01')).toBe('');
    expect(weeklyDateLabel('2026-02-30')).toBe('');
  });
});

describe('weeklySavedName', () => {
  const now = new Date(2026, 10, 21, 12, 0, 0); // Nov 21, 2026, local

  test('its own kind and its week\'s date', () => {
    expect(weeklySavedName({ title: 'Weekly Jams', date: '2026-11-17T00:00:00+00:00', weekLabel: 'This Week' }, now))
      .toBe('Weekly Jams · Nov 17, 2026');
    expect(weeklySavedName({ title: 'Weekly Exploration', date: '2026-11-10', weekLabel: 'Last Week' }, now))
      .toBe('Weekly Exploration · Nov 10, 2026');
  });

  test('a week with no date takes the day it was saved, never the relative week label', () => {
    expect(weeklySavedName({ title: 'Weekly Jams', weekLabel: 'This Week' }, now)).toBe('Weekly Jams · Nov 21, 2026');
    expect(weeklySavedName({ title: 'Weekly Jams', date: 'garbage', weekLabel: 'This Week' }, now)).toBe('Weekly Jams · Nov 21, 2026');
  });

  test('no title reads as a weekly playlist', () => {
    expect(weeklySavedName({ title: '  ', date: '2026-11-17' }, now)).toBe('Weekly playlist · Nov 17, 2026');
  });

  test('two weeks of the same kind get different names', () => {
    const a = weeklySavedName({ title: 'Weekly Jams', date: '2026-11-10', weekLabel: 'This Week' }, now);
    const b = weeklySavedName({ title: 'Weekly Jams', date: '2026-11-17', weekLabel: 'This Week' }, now);
    expect(a).not.toBe(b);
  });

  test('today is the local calendar day', () => {
    expect(todayIsoDate(new Date(2026, 0, 3, 23, 30))).toBe('2026-01-03');
  });
});

describe('the wiring', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  const view = read('src', 'renderer', 'components', 'playlist-view-page.js');
  const recs = read('src', 'renderer', 'components', 'recommendations-page.js');
  const app = read('src', 'renderer', 'app.js');
  const context = read('src', 'renderer', 'lib', 'playlist-context.js');

  test('Save names the copy by the rule and drops the relative week label from it', () => {
    expect(view).toContain('title: selectedPlaylist.weekLabel ? weeklySavedName(selectedPlaylist) : selectedPlaylist.title,');
    expect(view).not.toContain('Weekly Jam - ');
    const save = view.slice(view.indexOf('title: selectedPlaylist.weekLabel ? weeklySavedName'));
    expect(save.slice(0, 900)).toMatch(/delete newPlaylist\.isEphemeral;\s*delete newPlaylist\.weekLabel;/);
  });

  test('the week\'s date reaches the playlist that Save names: Recommendations, the restored view, the queue\'s reopen', () => {
    expect(recs).toMatch(/weekLabel: item\.weekly\.weekLabel,\s*date: item\.weekly\.date \|\| null,/);
    expect(recs).toMatch(/weekLabel: record\.weekLabel,\s*date: record\.date,/);
    expect(app).toMatch(/weekLabel: jam\.weekLabel,\s*date: jam\.date \|\| null,/);
    expect(context).toMatch(/'listenbrainzId', 'weekLabel', 'date',/);
  });
});
