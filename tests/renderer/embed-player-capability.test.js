// Embedded-player resolvers (SoundCloud's widget today) are routed by
// capability, never by resolver id, and the manifest stays parseable by the
// mobile clients.
const fs = require('fs');
const path = require('path');
const { embedPlayer, embedLinkFor, stopAllEmbedPlayers, EMBED_PLAYER_KINDS } = require('../../src/renderer/lib/embed-players');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appSrc = read('src/renderer/app.js');
const engineSrc = read('src/renderer/hooks/use-playback-engine.js');
const volumeSrc = read('src/renderer/hooks/use-volume.js');

describe('embedded-player routing', () => {
  test('SoundCloud opts in with a boolean capability and names its adapter outside `capabilities`', () => {
    const manifest = JSON.parse(read('plugins-src/soundcloud/manifest.json'));
    expect(manifest.capabilities.embedPlayer).toBe(true);
    expect(manifest.embedPlayer).toEqual({ adapter: 'soundcloud-widget' });
    expect(EMBED_PLAYER_KINDS).toContain(manifest.embedPlayer.adapter);
  });

  test('every plugin keeps boolean capability values (Android and iOS decode Map<String, Boolean>)', () => {
    const dir = path.join(ROOT, 'plugins-src');
    for (const id of fs.readdirSync(dir)) {
      const file = path.join(dir, id, 'manifest.json');
      if (!fs.existsSync(file)) continue;
      const caps = JSON.parse(fs.readFileSync(file, 'utf8')).capabilities || {};
      for (const [key, value] of Object.entries(caps)) {
        expect([id, key, typeof value]).toEqual([id, key, 'boolean']);
      }
    }
  });

  test('the resolver loader carries the embedPlayer block onto the resolver', () => {
    const loaderSrc = read('resolver-loader.js');
    expect(loaderSrc).toContain("embedPlayer: axe.embedPlayer && typeof axe.embedPlayer === 'object' ? { ...axe.embedPlayer } : null,");
  });

  test('the host looks the adapter up by capability, never by resolver id', () => {
    expect(appSrc).toContain('if (!resolver?.capabilities?.embedPlayer) return null;');
    expect(appSrc).toContain('const kind = embedPlayerKind(id);');
    expect(engineSrc).toContain('const embedKind = embedPlayerKind(resolverId);');
    expect(engineSrc).toContain('const activeEmbedKind = embedPlayerKind(currentTrack?._activeResolver);');
    expect(engineSrc).toContain('stopAllEmbedPlayers();');
    // Playback code names no service. (app.js keeps SoundCloud's sign-in and
    // settings checks, which really are SoundCloud's own.)
    for (const src of [engineSrc, volumeSrc]) {
      expect(src).not.toMatch(/=== 'soundcloud'/);
      expect(src).not.toContain("elementFor('soundcloud')");
    }
    expect(appSrc).not.toMatch(/(?:activeResolver(?:Id)?|currentResolverId|_activeResolver) === 'soundcloud'/);
    expect(appSrc).toContain('const isEmbedPlayer = !!embedPlayerKind(activeResolver);');
  });

  test('the registry creates one player per adapter, picks its link, and ignores unknown adapters', () => {
    expect(embedPlayer('no-such-adapter')).toBeNull();
    expect(embedLinkFor('no-such-adapter', { soundcloudUrl: 'x' })).toBeNull();
    expect(embedLinkFor('soundcloud-widget', { soundcloudUrl: 'https://soundcloud.com/a/b' })).toBe('https://soundcloud.com/a/b');
    expect(embedLinkFor('soundcloud-widget', {})).toBeNull();
    const player = embedPlayer('soundcloud-widget');
    expect(embedPlayer('soundcloud-widget')).toBe(player);
    expect(() => stopAllEmbedPlayers()).not.toThrow();
  });
});
