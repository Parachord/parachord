/**
 * #1523: what Shuffleupagus says when the AI plug-in's request fails comes
 * from the plug-in (its describeError), then the app's generic wording
 * (src/renderer/lib/ai-provider-errors.js). AIChatService used to branch on
 * `this.provider.id === 'ollama' | 'customllm'`.
 */
const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const { describeProviderError } = require('../../src/renderer/lib/ai-provider-errors');

const root = path.join(__dirname, '../..');
const loadAxe = (id) => JSON.parse(fs.readFileSync(path.join(root, 'plugins', `${id}.axe`), 'utf8'));

let plugins;
beforeAll(async () => {
  const loader = new ResolverLoader();
  await loader.loadResolvers(['ollama', 'customllm', 'chatgpt'].map(loadAxe));
  plugins = Object.fromEntries(['ollama', 'customllm', 'chatgpt'].map((id) => [id, loader.getResolver(id)]));
});

// The provider object createChatServiceFromPlugin builds.
const providerFor = (plugin, config = {}) => ({
  id: plugin.id, name: plugin.name, chat: plugin.chat, config,
  describeError: typeof plugin.describeError === 'function' ? plugin.describeError : undefined,
});

describe('a plug-in words its own failures', () => {
  test('Ollama: a connection failure names it and asks to start its local server', () => {
    const d = describeProviderError(new Error('Failed to fetch'), providerFor(plugins.ollama, { endpoint: 'http://localhost:11434' }));
    expect(d.message).toContain('Ollama');
    expect(d.serverUnavailable).toBe(true);
  });

  test('Ollama: a missing model says how to pull it', () => {
    const d = describeProviderError(new Error('Ollama error (404): model not found'), providerFor(plugins.ollama, { model: 'mistral' }));
    expect(d.message).toBe('Model "mistral" not installed. Run: ollama pull mistral');
    expect(d.serverUnavailable).toBe(false);
  });

  test('Ollama: key and rate-limit errors get the generic wording', () => {
    expect(describeProviderError(new Error('429 Too Many Requests'), providerFor(plugins.ollama)).message).toContain('Rate limit');
  });

  test('Custom LLM: its errors are already for people, so they pass through', () => {
    const msg = 'Endpoint returned 404. If this is an OpenAI-compatible server, the Base URL usually ends in /v1.';
    expect(describeProviderError(new Error(msg), providerFor(plugins.customllm)).message).toBe(msg);
    const conn = describeProviderError(new Error('Failed to fetch'), providerFor(plugins.customllm));
    expect(conn.message).toContain('custom LLM endpoint');
    expect(conn.serverUnavailable).toBe(false);
  });

  test('a plug-in without describeError gets the generic wording', () => {
    expect(typeof plugins.chatgpt.describeError).toBe('undefined');
    const p = providerFor(plugins.chatgpt);
    expect(describeProviderError(new Error('Failed to fetch'), p).message).toContain('internet connection');
    expect(describeProviderError(new Error('401 Unauthorized'), p).message).toContain('Invalid API key');
    expect(describeProviderError(new Error('404 Not Found'), p).message).toContain('AI model not found');
  });

  test('a plug-in of any id gets its own wording, and a throwing describeError falls back', () => {
    const own = { id: 'some-new-ai', config: {}, describeError: () => ({ message: 'My server is asleep.', serverUnavailable: true }) };
    expect(describeProviderError(new Error('Failed to fetch'), own)).toEqual({ message: 'My server is asleep.', serverUnavailable: true });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { id: 'x', config: {}, describeError: () => { throw new Error('boom'); } };
    expect(describeProviderError(new Error('Failed to fetch'), broken).message).toContain('internet connection');
    spy.mockRestore();
  });
});

describe('app wiring', () => {
  const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');

  test('AIChatService asks the lib, never the provider id', () => {
    const fn = app.slice(app.indexOf('  formatProviderError(error) {'), app.indexOf('  convertPlainTextToCards(content) {'));
    expect(fn).toContain('describeProviderError(error, this.provider)');
    expect(fn).not.toMatch(/provider\.id\s*===/);
    expect(app).not.toMatch(/this\.provider\.id === '(ollama|customllm)'/);
  });

  test('the chat provider carries the plug-in\'s describeError, and a local server failure offers to start it', () => {
    expect(app).toContain("describeError: typeof plugin.describeError === 'function' ? plugin.describeError : undefined,");
    expect(app).toContain('result.localServerUnavailable = true;');
    expect(app).toContain('if (response.localServerUnavailable && window.electron?.ollama) {');
  });
});
