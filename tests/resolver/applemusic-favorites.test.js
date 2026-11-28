/**
 * Apple Music's loves (parachord#1559 step 5): a song you love in Parachord
 * is favourited in Apple Music (a personal rating of 1) when "Push favorites
 * to Apple Music" is on. The plug-in reaches the account only through the
 * `musicKit` host bridge it declares as optional (the plug-in host contract);
 * the host finds the song by its catalog id first (needs: 'serviceId'), and
 * there's no import (Apple can't list favourites without naming ids).
 *
 * Runs the real .axe through the real ResolverLoader, with a fake host.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const LP = require('../../src/renderer/lib/love-providers');
const { desktopPluginHostSupplier, RENDERER_BRIDGES } = require('../../src/renderer/lib/plugin-host-supplier');

const ROOT = path.join(__dirname, '../..');
const axe = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/applemusic.axe'), 'utf8'));

const supplier = (musicKit) => ({
  platform: 'desktop',
  appVersion: () => '0.9.15',
  getConfig: () => ({}),
  openExternal: jest.fn(),
  bridges: musicKit ? { musicKit: () => musicKit } : {},
});
const load = (musicKit) => new ResolverLoader({ host: supplier(musicKit) }).createResolverInstance(axe);
const bridge = (over = {}) => ({
  isSignedIn: jest.fn(async () => true),
  favoriteSong: jest.fn(async () => ({ ok: true })),
  ...over,
});

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('the manifest', () => {
  test('declares loves with Apple\'s own word, by catalog id, and no import', () => {
    expect(axe.capabilities.lovedTracks).toBe(true);
    expect(LP.loveDescriptor(axe.loves)).toEqual({ contract: 1, verb: 'Favorite', needs: 'serviceId', canImport: false });
    expect(axe.requires).toEqual({ optionalHostBridges: ['musicKit'] });
    expect(LP.loveWords('Favorite')).toMatchObject({ plural: 'favorites', past: 'favorited', tracksNoun: 'favorited tracks' });
  });
});

describe('loveTrack', () => {
  const track = (source) => ({ artist: 'Radiohead', title: 'Pyramid Song', sources: source ? { applemusic: source } : {} });

  test('favourites the song by its catalog id, through the bridge', async () => {
    const mk = bridge();
    const am = load(mk);
    await expect(am.loveTrack(track({ appleMusicId: '1097862870', confidence: 0.95 }), {})).resolves.toEqual({ ok: true, ref: '1097862870' });
    expect(mk.favoriteSong).toHaveBeenCalledWith('1097862870');
    // A source that only carries its id as "applemusic-<id>" works too.
    await am.loveTrack(track({ id: 'applemusic-42' }), {});
    expect(mk.favoriteSong).toHaveBeenLastCalledWith('42');
  });

  test('no Apple Music source, or a song Apple won\'t take, is no match', async () => {
    const mk = bridge({ favoriteSong: jest.fn(async () => ({ ok: false, reason: 'not-found' })) });
    const am = load(mk);
    await expect(am.loveTrack(track(null), {})).resolves.toEqual({ ok: false, reason: 'no-match' });
    await expect(am.loveTrack(track({ appleMusicId: '1' }), {})).resolves.toEqual({ ok: false, reason: 'no-match' });
  });

  test('a failure throws, so the push retries it', async () => {
    const mk = bridge({ favoriteSong: jest.fn(async () => { throw new Error('Apple Music favorite failed: HTTP 500'); }) });
    await expect(load(mk).loveTrack(track({ appleMusicId: '1' }), {})).rejects.toThrow('HTTP 500');
  });

  test('a host without the bridge (the phones today) can\'t favourite, and says so', async () => {
    const am = load(null);
    expect(am.host.musicKit).toBeUndefined();
    await expect(am.isSignedIn()).resolves.toBe(false);
    await expect(am.loveTrack(track({ appleMusicId: '1' }), {})).rejects.toThrow('This app can’t favorite songs in Apple Music');
  });

  test('signed in is the account\'s, from the bridge', async () => {
    await expect(load(bridge()).isSignedIn()).resolves.toBe(true);
    await expect(load(bridge({ isSignedIn: jest.fn(async () => false) })).isSignedIn()).resolves.toBe(false);
  });
});

describe('through the host\'s wrapper', () => {
  test('a love provider on its own methods; signed in asks the account, not a setup check', async () => {
    const mk = bridge({ isSignedIn: jest.fn(async () => false) });
    const am = load(mk);
    expect(LP.lovesOf(am)).toMatchObject({ verb: 'Favorite', canImport: false });
    const provider = LP.loveProviderFor(am, { getConfig: async () => ({}) });
    await expect(provider.isSignedIn()).resolves.toBe(false);
    expect(provider.getLovedPage).toBeUndefined();
  });

  test('the track\'s verified source is used; without one, the plug-in\'s search picks it', async () => {
    const mk = bridge();
    const am = load(mk);
    const provider = LP.loveProviderFor(am, { getConfig: async () => ({}) });
    await provider.loveTrack({ artist: 'Radiohead', title: 'Pyramid Song', sources: { applemusic: { appleMusicId: '7', confidence: 0.9 } } });
    expect(mk.favoriteSong).toHaveBeenLastCalledWith('7');
    am.search = jest.fn(async () => [{ id: 'applemusic-8', appleMusicId: '8', artist: 'Radiohead', title: 'Pyramid Song' }]);
    await provider.loveTrack({ artist: 'Radiohead', title: 'Pyramid Song', sources: {} });
    expect(mk.favoriteSong).toHaveBeenLastCalledWith('8');
  });

  test('its Settings rows read the app\'s sign-in for it', () => {
    const am = load(bridge());
    expect(LP.loveRowState(am, { name: 'Apple Music', signedIn: false })).toEqual({
      signedIn: false, importReady: false, signedOutHint: 'Sign in to Apple Music first', importHint: 'Sign in to Apple Music first', offLabel: 'Signed out',
    });
    expect(LP.loveRowState(am, { name: 'Apple Music', signedIn: true }).signedIn).toBe(true);
  });
});

describe('the desktop host supplies the bridge', () => {
  test('musicKit is a renderer bridge, read live from window.__parachordMusicKit', () => {
    expect(Object.keys(RENDERER_BRIDGES)).toContain('musicKit');
    const win = {};
    const s = desktopPluginHostSupplier(win, () => ({}));
    expect(s.bridges.musicKit()).toBeNull();
    win.__parachordMusicKit = { isSignedIn: () => true };
    expect(s.bridges.musicKit()).toBe(win.__parachordMusicKit);
  });

  test('app.js sets it: signed in, and favouriting a song, nothing more', () => {
    const app = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8');
    const start = app.indexOf('window.__parachordMusicKit = {');
    const block = app.slice(start, app.indexOf('};', start));
    expect(block).toContain('isSignedIn: async () =>');
    expect(block).toContain('favoriteSong: (catalogId) => AppleMusicApi.favoriteSong(appleMusicApiDeps, catalogId),');
    expect((block.match(/^\s{2}\w+:/gm) || []).length).toBe(2);
  });
});
