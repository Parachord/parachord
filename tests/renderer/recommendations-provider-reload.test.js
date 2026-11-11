/**
 * The Recommendations page reloads when its provider set changes.
 *
 * Seen live (#1328): the app reopened on Recommendations (the restored last
 * view), the load-on-navigation effect ran before the plugins had loaded, so
 * recommendationProviders() was empty and the page showed only the
 * Shuffleupagus section, with no provider sections and no skeletons, until
 * you left the page and came back. Nothing re-ran the load when the plugins
 * arrived.
 *
 * The fix: a full load records the provider ids it asked, and a second effect
 * loads again when the current set differs while the page is open.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

describe('Recommendations reload when the provider set changes', () => {
  const load = app.slice(app.indexOf('const loadRecommendations = async (opts = {}) => {'), app.indexOf('const chatServices = getChatServices();', app.indexOf('const loadRecommendations = async')));

  test('a full load records the providers it asked; a Home (meta-only) load does not', () => {
    expect(load).toMatch(/if \(!metaOnly\) recommendationProviderIdsRef\.current = recommendationProviderKey\(providers\);/);
  });

  const navEffect = app.indexOf("if (activeView === 'recommendations' && cacheLoaded) {\n      loadRecommendations();");
  const reloadEffect = app.indexOf("if (recommendationProviderKey(recommendationProviders()) === recommendationProviderIdsRef.current) return;");

  test('the reload effect compares the current set with the recorded one', () => {
    expect(reloadEffect).toBeGreaterThan(-1);
    const body = app.slice(reloadEffect - 200, reloadEffect + 300);
    expect(body).toMatch(/if \(activeView !== 'recommendations' \|\| !cacheLoaded\) return;/);
    expect(body).toMatch(/loadRecommendations\(\);\s*\}, \[activeView, cacheLoaded, loadedResolvers, activeResolvers, metaServices\]\);/);
  });

  test('it is declared after the load-on-navigation effect, so a plain navigation loads once', () => {
    expect(navEffect).toBeGreaterThan(-1);
    expect(reloadEffect).toBeGreaterThan(navEffect);
  });

  test('its dependencies are declared above it (the TDZ rule)', () => {
    for (const decl of [
      'const [loadedResolvers, setLoadedResolvers] = useState(',
      'const [activeResolvers, setActiveResolvers] = useState(',
      'const [metaServices, setMetaServices] = useState(',
      'const [cacheLoaded, setCacheLoaded] = useState('
    ]) {
      const at = app.indexOf(decl);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeLessThan(reloadEffect);
    }
  });

  test('the refs recommendationProviders() reads are synced by effects declared earlier', () => {
    // Effects run in declaration order within a commit, so these refs are
    // current by the time the reload effect reads them.
    const metaSync = app.indexOf('useEffect(() => { metaServicesRef.current = metaServices; }, [metaServices]);');
    const activeSync = app.indexOf('activeResolversRef.current = activeResolvers;');
    expect(metaSync).toBeGreaterThan(-1);
    expect(activeSync).toBeGreaterThan(-1);
    expect(metaSync).toBeLessThan(reloadEffect);
    expect(activeSync).toBeLessThan(reloadEffect);
  });
});
