/**
 * The drop-in contract for a self-hosted stream resolver (Subsonic, Plex, the
 * next one): the host routes HTML5 playback by `capabilities.html5Stream`,
 * asks the plugin whether it is configured (`isConfigured`), and lets it
 * render its own settings (`settings.authType: 'custom'` + `renderSettings`).
 * Nothing in the renderer names such a plugin. These are source-marker tests
 * on the renderer source — src/renderer/app.js plus the extracted component
 * modules (TrackRow's badge lives in components/track-lists.js,
 * PluginSettingsPanel in components/settings-cards.js) — and the generated
 * .axe files, so a future "just add it to the list" edit fails here instead of
 * silently re-hardwiring a service.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const componentFiles = fs.readdirSync(path.join(RENDERER, 'components'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(RENDERER, 'components', f));
// FALLBACK_RESOLVERS embeds every bundled plugin's source, so strip those
// lines: the assertions are about the host, not the plugins it ships.
const appSrc = [path.join(RENDERER, 'app.js'), ...componentFiles]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n')
  .split('\n').filter((l) => !l.startsWith('  {"manifest"')).join('\n');
const readAxe = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', `${id}.axe`), 'utf8'));
const plex = readAxe('plex');
const subsonic = readAxe('subsonic');

describe('capabilities.html5Stream', () => {
  test('both self-hosted resolvers declare it alongside getStreamUrl', () => {
    for (const axe of [plex, subsonic]) {
      expect(axe.capabilities.html5Stream).toBe(true);
      expect(axe.capabilities.stream).toBe(true);
      expect(typeof axe.implementation.getStreamUrl).toBe('string');
    }
  });

  test('the host routes the shared element by capability, never by id', () => {
    expect(appSrc).toContain("const isHtml5StreamResolver = (id) => !!findLoadedResolver(id)?.capabilities?.html5Stream;");
    expect(appSrc).toContain("const usesSharedAudio = (id) => id === 'localfiles' || id === 'soundcloud' || isHtml5StreamResolver(id);");
    // the play branch, the progress-tracker skip and the element's error dialog
    expect(appSrc).toContain('if (isHtml5StreamResolver(resolverId)) {');
    expect(appSrc).toContain('const isHtml5Stream = isHtml5StreamResolver(activeResolver);');
    expect(appSrc).toContain('if (owner && isHtml5StreamResolver(owner)) {');
    // the resolver's own name labels its dialogs
    expect(appSrc).toContain('const streamLabel = resolver.name || resolverId;');
    // and no id comparison is left anywhere in the renderer
    expect(appSrc).not.toMatch(/=== 'plex'/);
    expect(appSrc).not.toMatch(/(?:activeResolver(?:Id)?|resolverId|currentResolverId|owner) === 'subsonic'/);
    expect(appSrc).not.toContain('metaServiceConfigs.plex');
    expect(appSrc).not.toContain('metaServiceConfigs.subsonic');
  });

  test('a resolver result identifies its resolver through sources: [id], not a host-known field', () => {
    expect(appSrc).toContain("else if (Array.isArray(trackOrSource.sources) && typeof trackOrSource.sources[0] === 'string') resolverId = trackOrSource.sources[0];");
    expect(appSrc).not.toContain('plexPartKey');
  });

  test('getResolverConfig hands any unlisted plugin its saved meta_service_configs entry', () => {
    expect(appSrc).toContain('return metaServiceConfigsRef.current?.[resolverId] || metaServiceConfigs[resolverId] || {};');
  });
});

describe('plugin-owned configuration', () => {
  test('the card asks the plugin whether it is configured', () => {
    expect(appSrc).toContain("if (typeof loadedForConfig?.isConfigured === 'function') {");
    expect(typeof plex.implementation.isConfigured).toBe('string');
    expect(typeof subsonic.implementation.isConfigured).toBe('string');
  });

  test('a custom authType renders the plugin\'s own panel through PluginSettingsPanel', () => {
    expect(plex.settings.authType).toBe('custom');
    expect(typeof plex.implementation.renderSettings).toBe('string');
    expect(appSrc).toContain('const PluginSettingsPanel = ({ resolver, ctx }) => {');
    expect(appSrc).toContain("((selectedResolver.settings?.authType === 'custom') || selectedResolver.authType === 'custom') && (() => {");
    expect(appSrc).toContain('return React.createElement(PluginSettingsPanel, { key: pluginId, resolver: loaded, ctx });');
    // the plugin writes config only through the host's save/clear (cache invalidation lives there)
    expect(appSrc).toMatch(/saveConfig: async \(next\) => \{\n\s+await saveMetaServiceConfig\(pluginId, next\);\n\s+delete resolverConfigCache\.current\[pluginId\];/);
  });

  test('the badge map falls back to the manifest colour for an unknown plugin', () => {
    expect(appSrc).toContain('const meta = resolverMeta[resolverId] || pluginBadgeMeta(resolverId, allResolvers);');
    expect(appSrc).toContain("const currentIconColor = resolverIconColors[currentResolverId] || resolver.color || '#A855F7';");
  });
});
