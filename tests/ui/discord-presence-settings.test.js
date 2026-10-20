/**
 * The Discord presence control in Settings → General.
 *
 * Marker tests (the project's idiom for renderer behaviour with no DOM
 * harness) for the four things a user actually depends on: the toggle exists
 * in the general tab, flipping it is what opens the connection, the
 * now-playing feed is gated behind it, and the renderer reports pause as
 * 'paused' rather than 'stopped' — main turns that into a cleared presence,
 * which resume puts back.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

function section(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

describe('Settings → General Discord presence control', () => {
  const settingsSection = section(
    "// Discord Rich Presence Section",
    "// Dialogs Section - Reset",
  );

  test('lives in the general tab, between Media Keys and Dialogs', () => {
    const generalTabStart = app.indexOf("settingsTab === 'general' && React.createElement");
    expect(generalTabStart).toBeGreaterThan(-1);
    expect(app.indexOf('// Discord Rich Presence Section')).toBeGreaterThan(generalTabStart);
    expect(app.indexOf('// Media Keys Section')).toBeLessThan(app.indexOf('// Discord Rich Presence Section'));
  });

  test('the toggle is an accessible switch bound to the stored setting', () => {
    expect(settingsSection).toMatch(/'Discord Presence'/);
    expect(settingsSection).toMatch(/role: 'switch'/);
    expect(settingsSection).toMatch(/'aria-checked': discordPresenceEnabled/);
    expect(settingsSection).toMatch(/'Share my now playing'/);
  });

  test('flipping it goes through main, which owns the persisted key', () => {
    // The renderer must not write discord_presence_enabled itself: main reads
    // it at startup, and two writers means the toggle can disagree with the
    // connection state after a restart.
    expect(settingsSection).toMatch(/discordBridge\.setEnabled\(next\)/);
    expect(app).not.toMatch(/store\.(?:set|delete)\(\s*'discord_presence_enabled'/);
  });

  test('there is no Application id field in the UI', () => {
    // Deliberate: a text box for the id would let a user typo their presence
    // into silence and invent a "Discord rejected the id" state that is
    // otherwise unreachable. The id ships hardcoded; forks use .env.
    expect(settingsSection).not.toMatch(/discordClientIdInput|setClientId|digits only/);
  });

  test('the connection state shown comes from main, not from a guess', () => {
    expect(settingsSection).toMatch(/discordPresenceState\?\.statusOverride/);
    expect(settingsSection).toMatch(/DISCORD_PRESENCE_STATUS_LABELS\[statusKey\]/);
    // Application id problems are reported separately from "Discord closed".
    expect(settingsSection).toMatch(/'No Discord Application id configured'|statusKey === 'not-configured'/);
  });

  test('the status re-reads while the row is visible instead of freezing on "Connecting\u2026"', () => {
    // The handshake resolves after setEnabled returns, and Discord can start
    // or close while the tab is open, so a single read at click time would
    // strand the label. Polling is bounded to the general tab.
    const refresh = section(
      '// Discord: the connection resolves asynchronously',
      '// OS Now Playing via navigator.mediaSession',
    );
    expect(refresh).toMatch(/if \(activeView !== 'settings' \|\| settingsTab !== 'general'\) return;/);
    expect(refresh).toMatch(/setInterval\(refresh, 3000\)/);
    expect(refresh).toMatch(/return \(\) => clearInterval\(timer\);/);
  });

  test('the now-playing feed is gated on the toggle and keyed on payload fields', () => {
    const feed = section(
      '// One combined snapshot per change',
      '// OS Now Playing via navigator.mediaSession',
    );
    expect(feed).toMatch(/if \(!discordPresenceEnabled \|\| !discordBridge\?\.updateState\) return;/);
    expect(feed).toMatch(/status: isPlaying \? 'playing' : 'paused'/);
    expect(feed).toMatch(/positionSeconds: progressRef\.current \|\| 0/);
    // Keyed on the payload fields, not currentTrack identity: the track
    // object churns several times per play (art / stream-quality backfills),
    // and each identity churn re-fires the effect with a computed start that
    // may round to a different second — re-sends the main-process dedupe
    // cannot see. A duration is pushed too: it becomes timestamps.end, which
    // Discord renders as a progress bar.
    expect(feed).toMatch(/const discordNowPlayingKey = currentTrack/);
    expect(feed).toMatch(/\}, \[discordNowPlayingKey, discordPresenceEnabled\]\)/);
    // currentTrack.duration is SECONDS (same units as progressRef — the
    // progress interpolation and the scrobbler's <30s floor compare them
    // directly). Dividing by 1000 here made a 251s track arrive as 0.251s:
    // end landed at the start and was dropped, so the bar never showed.
    expect(feed).toMatch(/durationSeconds: currentTrack\.duration \|\| 0/);
    expect(feed).not.toMatch(/durationSeconds: \/ 1000/);
    // The duration is part of the effect key: a duration arriving late
    // (Amazon's play-time repair) must update the bar.
    expect(feed).toMatch(/\$\{currentTrack\.duration \|\| 0\}/);
    // currentTrack identity must NOT be in the dep array.
    expect(feed).not.toMatch(/\}, \[currentTrack,/);
  });

  test('a seek re-anchors Discord\u2019s elapsed clock, once per drag gesture', () => {
    const seek = section('const handleSeek = useCallback', '}, [currentTrack, browserPlaybackActive, discordPresenceEnabled]);');
    // The re-anchor lives in the 1s-after-drag settle callback, not in the
    // per-tick path: the range input fires onChange continuously during a
    // drag, every position computes a different activity start, and the
    // payload dedupe never suppresses — so a per-tick push is a burst of
    // SET_ACTIVITYs. It also only fires while the seeked track is still the
    // one playing (a track change inside the window carries its own position).
    expect(seek).toMatch(/discordPresenceEnabled && window\.electron\?\.discordPresence\?\.updatePosition/);
    expect(seek).toMatch(/updatePosition\(newPosition\)/);
    expect(seek).toMatch(/currentTrackRef\.current === currentTrack/);
    const settle = seek.slice(seek.indexOf('seekTimeoutRef.current = setTimeout'));
    expect(settle).toMatch(/seekingRef\.current = false;/);
    // No per-tick push outside the settle callback: the only updatePosition in
    // handleSeek's body sits inside the setTimeout callback.
    const beforeSettle = seek.slice(0, seek.indexOf('seekTimeoutRef.current = setTimeout'));
    expect(beforeSettle).not.toMatch(/updatePosition/);
  });
});
