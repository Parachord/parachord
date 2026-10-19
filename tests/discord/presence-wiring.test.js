/**
 * Discord Rich Presence — wiring parity across the three layers.
 *
 * The feature is split renderer → preload bridge → main IPC handler →
 * presence manager. A channel or method renamed on one side of that chain
 * fails only when someone toggles the setting and stares at a silent profile,
 * which is the same failure class `tests/chat/dj-tools-executor-parity.test.js`
 * exists for. Parse the layers and cross-check them instead.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function preloadChannels() {
  const preload = read('preload.js');
  const start = preload.indexOf('discordPresence: {');
  expect(start).toBeGreaterThan(-1);
  const block = preload.slice(start, preload.indexOf('}', start));
  return [...block.matchAll(/ipcRenderer\.invoke\(\s*'(discordrpc:[a-z-]+)'/g)].map((m) => m[1]);
}

function mainHandlers() {
  const main = read('main.js');
  return new Set([...main.matchAll(/ipcMain\.handle\(\s*'(discordrpc:[a-z-]+)'/g)].map((m) => m[1]));
}

function managerMethods() {
  const presence = read('discord-presence.js');
  const start = presence.indexOf('const api = {');
  expect(start).toBeGreaterThan(-1);
  const block = presence.slice(start, presence.indexOf('\n  return api;'));
  return new Set([...block.matchAll(/^\s{4}([a-zA-Z]+)\(/gm)].map((m) => m[1]));
}

function rendererBridgeCalls() {
  const app = read('src/renderer/app.js');
  return new Set([
    ...app.matchAll(/\bdiscordBridge\??\.([a-zA-Z]+)\(/g),
    ...app.matchAll(/electron\??\.discordPresence\??\.([a-zA-Z]+)\(/g),
  ].map((m) => m[1]));
}

describe('Discord presence IPC bridge', () => {
  test('the preload exposes the expected channels', () => {
    const channels = preloadChannels();
    expect(channels.length).toBeGreaterThanOrEqual(7);
    expect(channels).toContain('discordrpc:update-state');
    expect(channels).toContain('discordrpc:set-enabled');
  });

  test('every channel the preload invokes has a main-process handler', () => {
    const handlers = mainHandlers();
    const missing = preloadChannels().filter((c) => !handlers.has(c));
    expect(missing).toEqual([]);
  });

  test('every handler main registers is reachable from the preload', () => {
    const exposed = new Set(preloadChannels());
    const orphans = [...mainHandlers()].filter((c) => !exposed.has(c));
    expect(orphans).toEqual([]);
  });

  test('main only calls methods the presence manager implements', () => {
    const main = read('main.js');
    const methods = managerMethods();
    const called = new Set(
      [...main.matchAll(/discordPresence\.([a-zA-Z]+)\(/g)].map((m) => m[1])
        .concat([...main.matchAll(/presence\.([a-zA-Z]+)\(/g)].map((m) => m[1])),
    );
    // `presence` is also used as a local name elsewhere; only judge the ones
    // that look like presence-manager verbs.
    const verbs = [...called].filter((name) => /^(set|get|update|clear|retry|dispose)/.test(name));
    expect(verbs.length).toBeGreaterThan(4);
    const missing = verbs.filter((name) => !methods.has(name));
    expect(missing).toEqual([]);
  });

  test('the renderer only calls bridge methods the preload exposes', () => {
    const preload = read('preload.js');
    const start = preload.indexOf('discordPresence: {');
    const block = preload.slice(start, preload.indexOf('}', start));
    const exposed = new Set([...block.matchAll(/^\s{4}([a-zA-Z]+):/gm)].map((m) => m[1]));
    const used = rendererBridgeCalls();
    const missing = [...used].filter((name) => !exposed.has(name));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(2);
  });
});

describe('Discord presence store keys', () => {
  test('only the toggle is persisted, and it is allowlisted', () => {
    const logic = read('discord-presence-logic.js');
    const keys = [...logic.matchAll(/^const ([A-Z_]+_STORE_KEY) = '([^']+)'/gm)].map((m) => m[2]);
    expect(keys).toEqual(['discord_presence_enabled']);

    const storeSrc = read('main-process/ipc/store.js');
    const start = storeSrc.indexOf('const ALLOWED_STORE_KEYS = new Set([');
    const allowed = new Set(
      storeSrc.slice(start, storeSrc.indexOf(']);', start)).match(/'([^']+)'/g).map((k) => k.slice(1, -1)),
    );
    const missing = keys.filter((key) => !allowed.has(key));
    expect(missing).toEqual([]);
  });

  test('the Application id is a build-time constant, never a persisted or user-typed value', () => {
    // Deliberate: the id names the Discord *application* (not the user), is
    // public in the binary regardless, and a settings field for it only
    // manufactures a way for a user to break their own presence. Forks and dev
    // builds use DISCORD_CLIENT_ID; users use the checkbox.
    const files = [
      'main.js', 'preload.js', 'src/renderer/app.js', 'main-process/ipc/store.js',
      'discord-presence-logic.js', 'discord-presence.js',
    ];
    for (const file of files) expect(read(file)).not.toMatch(/discord_client_id/);
    expect(read('discord-presence-logic.js')).toMatch(/const DEFAULT_DISCORD_CLIENT_ID = /);
    expect(read('main.js')).toMatch(/process\.env\.DISCORD_CLIENT_ID/);
    expect(read('.env.example')).toMatch(/DISCORD_CLIENT_ID=/);
  });

  test('main references the store key by constant, not by duplicate literal', () => {
    const main = read('main.js');
    expect(main).toMatch(/DISCORD_PRESENCE_ENABLED_STORE_KEY/);
    expect(main).not.toMatch(/store\.(?:get|set|delete)\(\s*'discord_/);
  });
});
