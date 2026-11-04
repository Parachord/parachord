// Embedded-player resolvers (SoundCloud's widget, Bandcamp's embed) are routed by
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

  test('Bandcamp opts in too, and stays stream: false so the mobile apps keep routing it to the browser', () => {
    const manifest = JSON.parse(read('plugins-src/bandcamp/manifest.json'));
    expect(manifest.capabilities.embedPlayer).toBe(true);
    expect(manifest.capabilities.stream).toBe(false);
    expect(manifest.embedPlayer).toEqual({ adapter: 'bandcamp-embed' });
    expect(EMBED_PLAYER_KINDS).toContain(manifest.embedPlayer.adapter);
    // An app without the adapter must not take it: 0.9.12 knows the capability
    // but not this adapter, and would fail the source.
    expect(manifest.manifest.minAppVersion.desktop).toBe('0.9.13');
  });

  test('Bandcamp links to its track page, which "Open in Bandcamp" opens', () => {
    expect(embedLinkFor('bandcamp-embed', { bandcampUrl: 'https://a.bandcamp.com/track/b' })).toBe('https://a.bandcamp.com/track/b');
    expect(embedLinkFor('bandcamp-embed', {})).toBeNull();
  });

  test('the embedded-player branch runs ahead of the stream: false one, and hands the adapter the source', () => {
    const embedAt = engineSrc.indexOf('const embedKind = embedPlayerKind(resolverId);');
    const externalAt = engineSrc.indexOf('if (!resolver.capabilities.stream) {');
    expect(embedAt).toBeGreaterThan(-1);
    expect(externalAt).toBeGreaterThan(embedAt);
    expect(engineSrc).toMatch(/\}, sourceToPlay\);/);
  });

  test('an adapter this build does not have is not an embedded player', () => {
    expect(appSrc).toContain("EMBED_PLAYER_KINDS.includes(kind) ? kind : null");
  });

  test('the floating mini window is gone', () => {
    for (const rel of ['main.js', 'preload.js', 'src/renderer/app.js', 'src/renderer/hooks/use-playback-engine.js']) {
      expect(read(rel)).not.toMatch(/playbackWindow|playback-window/);
    }
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
