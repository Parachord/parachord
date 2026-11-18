// lib/ai-services.js: the AI provider list and the scrobbler check that the
// app and its panels share.
const { servicesWithCapability, hasScrobblerConnected } = require('../../src/renderer/lib/ai-services');

const loader = { getAllResolvers: () => [
  { id: 'chatgpt', capabilities: { generate: true, chat: true } },
  { id: 'spotify', capabilities: { resolve: true } },
] };

test("the loader's plug-ins first, then meta services that haven't loaded", () => {
  const metas = [
    { id: 'chatgpt', capabilities: { generate: true } },
    { id: 'gemini', capabilities: { generate: true } },
    { id: 'lastfm', capabilities: {} },
  ];
  expect(servicesWithCapability('generate', loader, metas).map(s => s.id)).toEqual(['chatgpt', 'gemini']);
  expect(servicesWithCapability('chat', loader, metas).map(s => s.id)).toEqual(['chatgpt']);
});

test('no loader yet: only the meta services', () => {
  expect(servicesWithCapability('generate', null, [{ id: 'claude', capabilities: { generate: true } }]).map(s => s.id)).toEqual(['claude']);
  expect(servicesWithCapability('generate', null, undefined)).toEqual([]);
});

test('a Last.fm or ListenBrainz username counts as connected', () => {
  expect(hasScrobblerConnected({ lastfm: { username: 'a' } })).toBe(true);
  expect(hasScrobblerConnected({ listenbrainz: { username: 'b' } })).toBe(true);
  expect(hasScrobblerConnected({ lastfm: {} })).toBe(false);
  expect(hasScrobblerConnected(undefined)).toBe(false);
});
