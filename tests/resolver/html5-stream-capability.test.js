/**
 * The drop-in contract for a self-hosted stream resolver (Subsonic, the next
 * one): the host routes HTML5 playback by `capabilities.html5Stream` and asks
 * the plugin whether it is configured (`isConfigured`). Nothing in the
 * renderer names such a plugin. These are source-marker tests on the renderer
 * source — src/renderer/app.js plus the extracted component modules — and the
 * generated .axe files, so a future "just add it to the list" edit fails here
 * instead of silently re-hardwiring a service.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const componentFiles = fs.readdirSync(path.join(RENDERER, 'components'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(RENDERER, 'components', f));
// (The FALLBACK_RESOLVERS embed moved to the gitignored generated module —
// nothing to strip from app.js anymore; the assertions are about the host,
// and app.js no longer contains minified plugin implementation lines.)
const appSrc = [path.join(RENDERER, 'app.js'), path.join(RENDERER, 'hooks', 'use-playback-engine.js'), ...componentFiles]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const readAxe = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins', `${id}.axe`), 'utf8'));
const subsonic = readAxe('subsonic');

describe('capabilities.html5Stream', () => {
  test('Subsonic declares it alongside getStreamUrl', () => {
    expect(subsonic.capabilities.html5Stream).toBe(true);
    expect(subsonic.capabilities.stream).toBe(true);
    expect(typeof subsonic.implementation.getStreamUrl).toBe('string');
  });

  test('the host routes the shared element by capability, never by id', () => {
    expect(appSrc).toContain("const isHtml5StreamResolver = (id) => !!findLoadedResolver(id)?.capabilities?.html5Stream;");
    expect(appSrc).toContain("const usesSharedAudio = (id) => id === 'localfiles' || id === 'soundcloud' || isHtml5StreamResolver(id) || isWidevineResolver(id);");
    // the play branch, the progress-tracker skip and the element's error dialog
    expect(appSrc).toContain('if (isHtml5StreamResolver(resolverId)) {');
    expect(appSrc).toContain('const isHtml5Stream = isHtml5StreamResolver(activeResolver);');
    expect(appSrc).toContain('if (owner && isHtml5StreamResolver(owner)) {');
    // the resolver's own name labels its dialogs
    expect(appSrc).toContain('const streamLabel = resolver.name || resolverId;');
    // and no id comparison is left anywhere in the renderer
    expect(appSrc).not.toMatch(/(?:activeResolver(?:Id)?|resolverId|currentResolverId|owner) === 'subsonic'/);
    expect(appSrc).not.toContain('metaServiceConfigs.subsonic');
  });

  test('getResolverConfig hands any unlisted plugin its saved meta_service_configs entry', () => {
    expect(appSrc).toContain('return metaServiceConfigsRef.current?.[resolverId] || metaServiceConfigs[resolverId] || {};');
  });
});

describe('plugin-owned configuration', () => {
  test('the card asks the plugin whether it is configured', () => {
    expect(appSrc).toContain("if (typeof loadedForConfig?.isConfigured === 'function') {");
    expect(typeof subsonic.implementation.isConfigured).toBe('string');
  });
});
