// lib/ai-services.js: the AI provider list and the scrobbler check that the
// app and the AI prompt panel share.
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

test('AI playlist providers: generate plug-ins and chat-only ones (the chat fallback), by capability', () => {
  const { aiPlaylistServices } = require('../../src/renderer/lib/ai-services');
  const metas = [
    { id: 'chatgpt', capabilities: { generate: true, chat: true } },
    { id: 'claude', capabilities: { chat: true } },
    { id: 'ollama', capabilities: { chat: true } },
    { id: 'lastfm', capabilities: { recommendations: true } },
  ];
  expect(aiPlaylistServices(loader, metas).map(s => s.id)).toEqual(['chatgpt', 'claude', 'ollama']);
  expect(servicesWithCapability(['generate', 'chat'], null, metas).map(s => s.id)).toEqual(['chatgpt', 'claude', 'ollama']);
});
