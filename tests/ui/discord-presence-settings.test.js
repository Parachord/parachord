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

  test('the now-playing feed is gated on the toggle', () => {
    const feed = section(
      '// One combined snapshot per change',
      '// OS Now Playing via navigator.mediaSession',
    );
    expect(feed).toMatch(/if \(!discordPresenceEnabled \|\| !discordBridge\?\.updateState\) return;/);
    expect(feed).toMatch(/status: isPlaying \? 'playing' : 'paused'/);
    expect(feed).toMatch(/positionSeconds: progressRef\.current \|\| 0/);
  });

  test('a seek re-anchors Discord\u2019s elapsed clock', () => {
    const seek = section('const handleSeek = useCallback', '// Apple Music (native MusicKit, MusicKit JS, or preview audio)');
    expect(seek).toMatch(/discordPresenceEnabled && window\.electron\?\.discordPresence\?\.updatePosition/);
    expect(seek).toMatch(/updatePosition\(newPosition\)/);
  });
});
