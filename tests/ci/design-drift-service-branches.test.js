/**
 * What design-drift's serviceNameBranches counts (#1523): a comparison of a
 * plug-in's id (x.id, resolverId, providerId, serviceId, pluginId) with a
 * shipped plug-in's id. A string that equals a plug-in id but names something
 * else is not a branch on the plug-in: MusicBrainz's relation types
 * (rel.type === 'youtube'), a link's kind (classified.kind === 'achordion').
 */
const { scanSource } = require('../../scripts/design-drift');

const count = (src) => scanSource(src).counts.serviceNameBranches;

describe('serviceNameBranches', () => {
  test('counts comparisons of a plug-in id with a shipped plug-in', () => {
    expect(count("if (r.id === 'bandcamp') {}")).toBe(1);
    expect(count("if ('bandcamp' === r.id) {}")).toBe(1);
    expect(count("if (this.provider.id === 'ollama') {}")).toBe(1);
    expect(count("if (resolverId !== 'applemusic') {}")).toBe(1);
    expect(count("const a = providerId === 'spotify' || providerId == 'listenbrainz';")).toBe(2);
    expect(count("if (serviceId === 'lastfm' || pluginId === 'youtube') {}")).toBe(2);
  });

  test('MusicBrainz relation types and link kinds are not branches on a plug-in', () => {
    expect(count("if (rel.type === 'youtube' && rel.url?.resource) {}")).toBe(0);
    expect(count("if (a) {} else if (rel.type === 'bandcamp' && rel.url?.resource) {}")).toBe(0);
    expect(count("if (classified.kind === 'achordion') {}")).toBe(0);
  });

  test('an id compared with something that is not a plug-in is not counted', () => {
    expect(count("if (r.id === 'not-a-plugin') {}")).toBe(0);
    expect(count("if (resolverId === someVar) {}")).toBe(0);
  });
});
