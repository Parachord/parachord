// lib/ai-generate.js: an AI playlist from any AI plug-in. A plug-in's own
// generate when it has one; a chat-only plug-in (Claude, Ollama) gets the
// same request through chat.
const fs = require('fs');
const path = require('path');
const {
  generateAiPlaylist, parsePlaylist, playlistMessages, playlistSystemPrompt, PLAYLIST_SYSTEM_PROMPT,
} = require('../../src/renderer/lib/ai-generate');
const { errorText } = require('../../src/renderer/lib/error-copy');

describe('the prompt', () => {
  test('matches chatgpt generate\'s system prompt', () => {
    const chatgpt = fs.readFileSync(path.join(__dirname, '../../plugins-src/chatgpt/implementation.js'), 'utf8');
    expect(chatgpt).toContain(PLAYLIST_SYSTEM_PROMPT.replace(/'/g, "\\'"));
  });
  test('without history: the system prompt alone', () => {
    expect(playlistSystemPrompt(null)).toBe(PLAYLIST_SYSTEM_PROMPT);
    expect(playlistMessages('sad songs', null)).toEqual([
      { role: 'system', content: PLAYLIST_SYSTEM_PROMPT },
      { role: 'user', content: 'sad songs' },
    ]);
  });
  test('with history: appended as JSON', () => {
    const ctx = { topArtists: ['Low'] };
    const [system, user] = playlistMessages('sad songs', ctx);
    expect(system.content).toBe(`${PLAYLIST_SYSTEM_PROMPT}\n\nUser's listening history for context:\n{"topArtists":["Low"]}`);
    expect(user).toEqual({ role: 'user', content: 'sad songs' });
  });
});

describe('parsing the reply', () => {
  const tracks = [{ title: 'Words', artist: 'Low' }, { title: 'Lazy', artist: 'Low' }];
  test('bare JSON', () => {
    expect(parsePlaylist(JSON.stringify(tracks))).toEqual(tracks);
  });
  test('fenced JSON with prose around it', () => {
    expect(parsePlaylist('Here you go:\n```json\n' + JSON.stringify(tracks, null, 2) + '\n```\nEnjoy!')).toEqual(tracks);
  });
  test('an unreadable reply throws a user-readable error', () => {
    for (const bad of ['Sorry, I can’t help with that.', '', undefined, '{"title":"x"}']) {
      let err;
      try { parsePlaylist(bad); } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(errorText(err, 'fallback')).toMatch(/^Couldn’t read a playlist/);
    }
  });
});

describe('choosing generate or the chat fallback', () => {
  test('a plug-in with generate uses its own', async () => {
    const service = {
      capabilities: { generate: true, chat: true },
      generate: jest.fn(async () => [{ title: 'a', artist: 'b' }]),
      chat: jest.fn(),
    };
    await expect(generateAiPlaylist(service, 'p', { apiKey: 'k' }, null)).resolves.toEqual([{ title: 'a', artist: 'b' }]);
    expect(service.generate).toHaveBeenCalledWith('p', { apiKey: 'k' }, null);
    expect(service.chat).not.toHaveBeenCalled();
  });
  test('a chat-only plug-in goes through chat: [system, user], no tools', async () => {
    const service = {
      capabilities: { chat: true },
      chat: jest.fn(async () => ({ content: '```json\n[{"title":"a","artist":"b"}]\n```', toolCalls: [] })),
    };
    const ctx = { recent: [] };
    await expect(generateAiPlaylist(service, 'p', { apiKey: 'k' }, ctx)).resolves.toEqual([{ title: 'a', artist: 'b' }]);
    expect(service.chat).toHaveBeenCalledWith(playlistMessages('p', ctx), [], { apiKey: 'k' });
  });
  test('a plug-in that has not loaded yet says so', async () => {
    await expect(generateAiPlaylist({ name: 'Claude', capabilities: { chat: true } }, 'p', {}, null))
      .rejects.toMatchObject({ userMessage: expect.stringContaining('Claude') });
  });
});

test('the AI playlist flow goes through generateAiPlaylist, and lists chat plug-ins', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toContain("require('./lib/ai-generate')");
  expect(app).toContain('await generateAiPlaylist(service, prompt, config, listeningContext)');
  expect(app).not.toMatch(/service\.generate\(prompt/);
  expect(app).toMatch(/getAiServices = \(\) => aiPlaylistServices\(/);
  const panel = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/ai-prompt-panel.js'), 'utf8');
  expect(panel).toContain('aiPlaylistServices(resolverLoaderRef.current, metaServices)');
  expect(panel).not.toContain("servicesWithCapability('generate'");
});
