/**
 * The request bodies the ChatGPT and Gemini plugins send. Home's AI
 * suggestions call chat() with an empty tools list (they want a plain JSON
 * answer); ChatGPT used to send that as `tools: []` + `tool_choice: 'auto'`,
 * which OpenAI rejects with a 400, so every Refresh failed in about a second
 * and the old suggestions stayed. GPT-5 and the o-series also refuse any
 * temperature but the default, so 0.7 broke chat on those models.
 */

const chatgpt = require('../../plugins-src/chatgpt/implementation');
const gemini = require('../../plugins-src/gemini/implementation');

const TOOL = { name: 'play', description: 'Play a track', parameters: { type: 'object', properties: {} } };
const MESSAGES = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

let lastBody;
beforeEach(() => {
  lastBody = null;
  global.fetch = jest.fn(async (url, init) => {
    lastBody = JSON.parse(init.body);
    const openai = { choices: [{ message: { content: '[]' } }] };
    const google = { candidates: [{ content: { parts: [{ text: '[]' }] } }] };
    return { ok: true, json: async () => (String(url).includes('openai') ? openai : google) };
  });
});
afterEach(() => { delete global.fetch; });

describe('ChatGPT plugin request body', () => {
  test('an empty tools list sends no tools and no tool_choice', async () => {
    await chatgpt.chat(MESSAGES, [], { apiKey: 'k' });
    expect(lastBody).not.toHaveProperty('tools');
    expect(lastBody).not.toHaveProperty('tool_choice');
  });

  test('real tools are sent with tool_choice auto', async () => {
    await chatgpt.chat(MESSAGES, [TOOL], { apiKey: 'k' });
    expect(lastBody.tools).toHaveLength(1);
    expect(lastBody.tool_choice).toBe('auto');
  });

  test.each(['gpt-5-mini', 'gpt-5', 'gpt-5.1', 'o3-mini', 'o4-mini'])(
    '%s gets the default temperature (none sent), in chat and generate',
    async (model) => {
      await chatgpt.chat(MESSAGES, [], { apiKey: 'k', model });
      expect(lastBody).not.toHaveProperty('temperature');
      await chatgpt.generate('prompt', { apiKey: 'k', model });
      expect(lastBody).not.toHaveProperty('temperature');
    },
  );

  test.each([undefined, 'gpt-4o-mini', 'gpt-4.1', 'gpt-5-chat-latest'])(
    '%s keeps temperature 0.7',
    async (model) => {
      await chatgpt.chat(MESSAGES, [], { apiKey: 'k', model });
      expect(lastBody.temperature).toBe(0.7);
    },
  );
});

describe('Gemini plugin request body', () => {
  test('an empty tools list sends no tools', async () => {
    await gemini.chat(MESSAGES, [], { apiKey: 'k' }).catch(() => {});
    expect(lastBody).not.toHaveProperty('tools');
  });

  test('real tools are sent as functionDeclarations', async () => {
    await gemini.chat(MESSAGES, [TOOL], { apiKey: 'k' }).catch(() => {});
    expect(lastBody.tools[0].functionDeclarations).toHaveLength(1);
  });
});
