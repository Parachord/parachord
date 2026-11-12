/**
 * Home's Ask Shuffleupagus box sends through parachord://chat with an in-app
 * origin that skips the confirmation dialog. The origin must only come from
 * the renderer's direct call, never from the URL or from IPC.
 */
const fs = require('fs');
const path = require('path');
const { buildChatPromptUrl, shouldSendPendingChatPrompt } = require('../../protocol-url');

const appSrc = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('buildChatPromptUrl', () => {
  test('round-trips awkward characters through the URL', () => {
    const prompt = 'rock & roll? #1 "yes" 🎸';
    const url = buildChatPromptUrl(prompt);
    expect(url.startsWith('parachord://chat?prompt=')).toBe(true);
    expect(new URL(url).searchParams.get('prompt')).toBe(prompt);
  });

  test('caps the prompt at 500 characters', () => {
    const url = buildChatPromptUrl('a'.repeat(600));
    expect(new URL(url).searchParams.get('prompt')).toHaveLength(500);
  });
});

describe('buildChatPromptUrl surrogate boundary', () => {
  test('a cut that splits a surrogate pair does not throw', () => {
    const url = buildChatPromptUrl('a'.repeat(499) + '🎸');
    expect(new URL(url).searchParams.get('prompt')).toBe('a'.repeat(499));
  });
  test('a pair that fits whole is kept', () => {
    const url = buildChatPromptUrl('a'.repeat(498) + '🎸');
    expect(new URL(url).searchParams.get('prompt')).toBe('a'.repeat(498) + '🎸');
  });
});

describe('shouldSendPendingChatPrompt', () => {
  const ready = { pending: 'hi', chatOpen: true, providerId: 'ollama', loading: false };
  test('sends once the panel is open with a provider and idle', () => {
    expect(shouldSendPendingChatPrompt(ready)).toBe(true);
  });
  test.each([
    ['nothing pending', { pending: null }],
    ['blank prompt', { pending: '  ' }],
    ['panel not committed open', { chatOpen: false }],
    ['no provider yet (first-time user)', { providerId: null }],
    ['a reply is in flight', { loading: true }],
  ])('waits when %s', (_n, over) => {
    expect(shouldSendPendingChatPrompt({ ...ready, ...over })).toBe(false);
  });
});

describe('home path defers the send (source pins)', () => {
  const start = appSrc.indexOf("case 'chat'");
  const chat = appSrc.slice(start, appSrc.indexOf("case 'listen-along'"));
  const home = chat.slice(chat.indexOf("origin === 'home'"), chat.indexOf('showConfirmDialog'));
  test('the home branch queues the prompt and never sends synchronously', () => {
    expect(home).toContain('pendingChatPromptRef.current');
    expect(home).not.toContain('handleAiChatSendRef.current(');
  });
  test('the external path still sends only from the dialog confirm', () => {
    expect(chat.slice(chat.indexOf('showConfirmDialog'))).toContain('handleAiChatSendRef.current(prompt)');
  });
  test('a bailed openAiChat clears the pending prompt', () => {
    expect(chat).toMatch(/chatOpened === false \? null : prompt/);
  });
});

describe('protocol callback origin (source pins)', () => {
  const start = appSrc.indexOf('const dispatchProtocolUrl = async (url');
  const end = appSrc.indexOf('window.electron.onProtocolUrl((url) => dispatchProtocolUrl(url))');
  const callback = start >= 0 && end > start ? appSrc.slice(start, end) : '';

  test('IPC calls the dispatcher with no second argument', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(appSrc).not.toMatch(/onProtocolUrl\(\s*\([^)]*,[^)]*\)\s*=>/);
  });

  test('the origin is a direct-call option defaulting to external', () => {
    expect(appSrc).toMatch(/dispatchProtocolUrl = async \(url, \{ origin = 'external' \} = \{\}\)/);
    expect(appSrc).toMatch(/dispatchProtocolUrlRef\.current = dispatchProtocolUrl/);
  });

  test('nothing in the URL sets the origin', () => {
    expect(callback).not.toMatch(/params\.origin|params\['origin'\]|searchParams\.get\('origin'\)|origin\s*=\s*params/);
  });

  test('the chat case skips the dialog only for the home origin', () => {
    const chat = callback.slice(callback.indexOf("case 'chat'"), callback.indexOf("case 'listen-along'"));
    expect(chat).toContain("origin === 'home'");
    expect(chat).toContain('showConfirmDialog');
    expect(chat.indexOf("origin === 'home'")).toBeLessThan(chat.indexOf('showConfirmDialog'));
  });

  test('askShuffleupagus dispatches with the home origin', () => {
    expect(appSrc).toMatch(/dispatchProtocolUrlRef\.current\(window\.buildChatPromptUrl\(prompt\), \{ origin: 'home' \}\)/);
  });
});
