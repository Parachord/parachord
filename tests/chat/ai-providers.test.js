/**
 * AI Provider Format Translation Tests
 *
 * Tests that each provider's chat() function correctly translates
 * between Parachord's internal message format and the provider's API format.
 * Uses mocked fetch to verify request bodies and parse responses.
 */

const fs = require('fs');
const path = require('path');

// Mock global fetch
const originalFetch = global.fetch;
let mockFetch;

beforeEach(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Helper to load .axe file (JSON with .axe extension)
function loadAxe(axeFile) {
  const filePath = path.join(__dirname, '..', '..', 'plugins', axeFile);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Helper to extract the chat function from .axe JSON
function loadChatFn(axeFile) {
  const axe = loadAxe(axeFile);
  // eslint-disable-next-line no-eval
  return eval(`(${axe.implementation.chat})`);
}

function loadGenerateFn(axeFile) {
  const axe = loadAxe(axeFile);
  if (!axe.implementation.generate) return null;
  return eval(`(${axe.implementation.generate})`);
}

function loadTestConnectionFn(axeFile) {
  const axe = loadAxe(axeFile);
  if (!axe.implementation.testConnection) return null;
  return eval(`(${axe.implementation.testConnection})`);
}

const sampleMessages = [
  { role: 'system', content: 'You are a DJ assistant.' },
  { role: 'user', content: 'Play some rock music' }
];

const sampleTools = [
  { name: 'play', description: 'Play a track', parameters: { type: 'object', properties: { artist: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'search', description: 'Search tracks', parameters: { type: 'object', properties: { query: { type: 'string' } } } }
];

const messagesWithToolCalls = [
  { role: 'system', content: 'You are a DJ.' },
  { role: 'user', content: 'Play Creep by Radiohead' },
  { role: 'assistant', content: 'Let me play that', tool_calls: [{ id: 'call-1', name: 'play', arguments: { artist: 'Radiohead', title: 'Creep' } }] },
  { role: 'tool', tool_call_id: 'call-1', content: '{"success":true}' }
];

describe('ChatGPT Provider', () => {
  let chat;

  beforeEach(() => {
    chat = loadChatFn('chatgpt.axe');
  });

  test('sends correct request format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Here are some rock tracks!', tool_calls: null } }]
      })
    });

    await chat(sampleMessages, sampleTools, { apiKey: 'sk-test', model: 'gpt-4o-mini' });

    expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Authorization': 'Bearer sk-test'
      })
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('play');
  });

  test('parses text response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Rock on!', tool_calls: null } }]
      })
    });

    const result = await chat(sampleMessages, sampleTools, { apiKey: 'sk-test' });

    expect(result.content).toBe('Rock on!');
    expect(result.toolCalls).toBeNull();
  });

  test('parses tool call response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'play', arguments: '{"artist":"Radiohead","title":"Creep"}' }
            }]
          }
        }]
      })
    });

    const result = await chat(sampleMessages, sampleTools, { apiKey: 'sk-test' });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('call_123');
    expect(result.toolCalls[0].name).toBe('play');
    expect(result.toolCalls[0].arguments).toEqual({ artist: 'Radiohead', title: 'Creep' });
  });

  test('converts tool_calls in assistant messages to OpenAI format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Done!', tool_calls: null } }]
      })
    });

    await chat(messagesWithToolCalls, sampleTools, { apiKey: 'sk-test' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const assistantMsg = body.messages.find(m => m.role === 'assistant' && m.tool_calls);

    expect(assistantMsg.tool_calls[0].type).toBe('function');
    expect(assistantMsg.tool_calls[0].function.name).toBe('play');
    expect(typeof assistantMsg.tool_calls[0].function.arguments).toBe('string');
  });

  test('throws on missing API key', async () => {
    await expect(chat(sampleMessages, sampleTools, {}))
      .rejects.toThrow('API key not configured');
  });

  test('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } })
    });

    await expect(chat(sampleMessages, sampleTools, { apiKey: 'bad-key' }))
      .rejects.toThrow('Invalid API key');
  });
});

describe('Claude Provider', () => {
  let chat;

  beforeEach(() => {
    chat = loadChatFn('claude.axe');
  });

  test('sends correct request format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'Here you go!' }]
      })
    });

    await chat(sampleMessages, sampleTools, { apiKey: 'sk-ant-test', model: 'claude-sonnet-4-20250514' });

    expect(mockFetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'sk-ant-test',
        'anthropic-version': '2023-06-01'
      })
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.system).toBe('You are a DJ assistant.');
    // System message should NOT be in the messages array
    expect(body.messages.every(m => m.role !== 'system')).toBe(true);
    expect(body.messages).toHaveLength(1); // only user message
    expect(body.tools[0].input_schema).toBeDefined();
    expect(body.max_tokens).toBe(1024);
  });

  test('parses text response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'Here are some recommendations!' }]
      })
    });

    const result = await chat(sampleMessages, sampleTools, { apiKey: 'sk-ant-test' });

    expect(result.content).toBe('Here are some recommendations!');
    expect(result.toolCalls).toBeNull();
  });

  test('parses tool_use response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [
          { type: 'text', text: 'Let me play that for you' },
          { type: 'tool_use', id: 'tu_123', name: 'play', input: { artist: 'Radiohead', title: 'Creep' } }
        ]
      })
    });

    const result = await chat(sampleMessages, sampleTools, { apiKey: 'sk-ant-test' });

    expect(result.content).toBe('Let me play that for you');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe('tu_123');
    expect(result.toolCalls[0].name).toBe('play');
    expect(result.toolCalls[0].arguments).toEqual({ artist: 'Radiohead', title: 'Creep' });
  });

  test('converts tool results to user messages with tool_result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'Done!' }]
      })
    });

    await chat(messagesWithToolCalls, sampleTools, { apiKey: 'sk-ant-test' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Tool result should be a user message with tool_result content
    const toolResultMsg = body.messages.find(m =>
      m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0].tool_use_id).toBe('call-1');
  });

  test('converts assistant tool_calls to tool_use blocks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: 'Done!' }]
      })
    });

    await chat(messagesWithToolCalls, sampleTools, { apiKey: 'sk-ant-test' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const assistantMsg = body.messages.find(m => m.role === 'assistant' && Array.isArray(m.content));
    expect(assistantMsg).toBeDefined();
    const toolUseBlock = assistantMsg.content.find(c => c.type === 'tool_use');
    expect(toolUseBlock.name).toBe('play');
    expect(toolUseBlock.input).toEqual({ artist: 'Radiohead', title: 'Creep' });
  });

  test('throws on missing API key', async () => {
    await expect(chat(sampleMessages, sampleTools, {}))
      .rejects.toThrow('API key is required');
  });

  test('throws friendly error on auth failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({
        error: { type: 'authentication_error', message: 'invalid x-api-key' }
      }))
    });

    await expect(chat(sampleMessages, sampleTools, { apiKey: 'bad' }))
      .rejects.toThrow('Invalid API key');
  });

  test('throws friendly error on rate limit', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve(JSON.stringify({
        error: { type: 'rate_limit_error', message: 'rate limited' }
      }))
    });

    await expect(chat(sampleMessages, sampleTools, { apiKey: 'key' }))
      .rejects.toThrow('Rate limit');
  });

  test('throws friendly error on overload', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 529,
      text: () => Promise.resolve(JSON.stringify({
        error: { message: 'overloaded' }
      }))
    });

    await expect(chat(sampleMessages, sampleTools, { apiKey: 'key' }))
      .rejects.toThrow('overloaded');
  });
});

describe('Ollama Provider', () => {
  let chat;

  beforeEach(() => {
    chat = loadChatFn('ollama.axe');
  });

  test('sends correct request format', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: 'Here you go!', role: 'assistant' }
      })
    });

    await chat(sampleMessages, sampleTools, { endpoint: 'http://localhost:11434', model: 'llama3.1' });

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.objectContaining({
      method: 'POST'
    }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(2);
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0].type).toBe('function');
  });

  test('parses text response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: { content: 'Rock on!', role: 'assistant' }
      })
    });

    const result = await chat(sampleMessages, sampleTools, { model: 'llama3.1' });

    expect(result.content).toBe('Rock on!');
    expect(result.toolCalls).toBeNull();
  });

  test('parses tool call response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: {
          content: '',
          role: 'assistant',
          tool_calls: [{
            function: {
              name: 'play',
              arguments: { artist: 'Radiohead', title: 'Creep' }
            }
          }]
        }
      })
    });

    const result = await chat(sampleMessages, sampleTools, { model: 'llama3.1' });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('play');
    expect(result.toolCalls[0].arguments).toEqual({ artist: 'Radiohead', title: 'Creep' });
    // Should generate an ID when none provided
    expect(result.toolCalls[0].id).toBeDefined();
  });

  test('handles string tool arguments', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        message: {
          content: '',
          tool_calls: [{
            function: {
              name: 'play',
              arguments: '{"artist":"Radiohead","title":"Creep"}'
            }
          }]
        }
      })
    });

    const result = await chat(sampleMessages, sampleTools, { model: 'llama3.1' });

    expect(result.toolCalls[0].arguments).toEqual({ artist: 'Radiohead', title: 'Creep' });
  });

  test('uses default endpoint and model', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: { content: 'Hi' } })
    });

    await chat(sampleMessages, sampleTools, {});

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.anything());
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.1');
  });

  test('throws on API error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('model not found')
    });

    await expect(chat(sampleMessages, sampleTools, { model: 'nonexistent' }))
      .rejects.toThrow('Ollama error');
  });
});

describe('Ollama testConnection', () => {
  let testConnection;

  beforeEach(() => {
    testConnection = loadTestConnectionFn('ollama.axe');
  });

  test('returns success with model list', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [{ name: 'llama3.1' }, { name: 'mistral' }]
      })
    });

    const result = await testConnection({ endpoint: 'http://localhost:11434' });

    expect(result.success).toBe(true);
    expect(result.models).toEqual(['llama3.1', 'mistral']);
    expect(result.message).toContain('2 model(s)');
  });

  test('returns failure on connection error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await testConnection({ endpoint: 'http://localhost:11434' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  test('returns failure on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const result = await testConnection({});

    expect(result.success).toBe(false);
  });
});

describe('ChatGPT generate', () => {
  let generate;

  beforeEach(() => {
    generate = loadGenerateFn('chatgpt.axe');
  });

  test('parses JSON array from response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: '[{"title":"Creep","artist":"Radiohead"},{"title":"Smells Like Teen Spirit","artist":"Nirvana"}]'
          }
        }]
      })
    });

    const result = await generate('Give me rock songs', { apiKey: 'sk-test' });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ title: 'Creep', artist: 'Radiohead' });
  });

  test('extracts JSON from surrounding text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: 'Here are some songs:\n[{"title":"Creep","artist":"Radiohead"}]\nEnjoy!'
          }
        }]
      })
    });

    const result = await generate('Rock songs', { apiKey: 'sk-test' });

    expect(result).toHaveLength(1);
  });

  test('throws on missing API key', async () => {
    await expect(generate('test', {})).rejects.toThrow('API key not configured');
  });

  test('includes listening context in prompt', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '[]' } }]
      })
    });

    const listeningContext = { topArtists: ['Radiohead'] };
    await generate('test', { apiKey: 'sk-test' }, listeningContext);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('Radiohead');
  });
});
