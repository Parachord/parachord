// Source of truth for plugins/chatgpt.axe v2.2.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  generate: async function (prompt, config, listeningContext) {
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const model = config.model || 'gpt-4o-mini';

    let systemPrompt =
      'You are a music expert. Generate a playlist based on the user\'s request. Return ONLY a JSON array of objects with "title" and "artist" fields. No explanations, just the JSON array. Example: [{"title": "Song Name", "artist": "Artist Name"}]';

    if (listeningContext) {
      systemPrompt +=
        "\n\nUser's listening history for context:\n" + JSON.stringify(listeningContext);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '[]';

    try {
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse ChatGPT response:', content);
      throw new Error('Could not parse playlist from response');
    }
  },
  listModels: async function (config) {
    const apiKey = config.apiKey;
    if (!apiKey) return [];
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const BLOCKLIST = [
      'dall-e',
      'whisper',
      'tts',
      'text-embedding',
      'babbage',
      'davinci',
      'canary',
      'moderation',
      'embedding',
    ];
    const models = (data.data || [])
      .filter((m) => !BLOCKLIST.some((prefix) => m.id.startsWith(prefix)))
      .filter(
        (m) => !m.id.includes('realtime') && !m.id.includes('audio') && !m.id.includes('transcri'),
      )
      .filter((m) => !/\d{4}-\d{2}-\d{2}|-\d{4}$|preview/.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    return models.map((m) => ({ value: m.id, label: m.id }));
  },
  chat: async function (messages, tools, config) {
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const model = config.model || 'gpt-4o-mini';

    const openaiTools = tools
      ? tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        }))
      : undefined;

    // Convert messages to OpenAI format
    // Tool calls need type: 'function' and stringified arguments
    const openaiMessages = messages.map((msg) => {
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return msg;
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: openaiMessages,
        tools: openaiTools,
        tool_choice: openaiTools ? 'auto' : undefined,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    const result = {
      content: message.content || '',
      toolCalls: null,
    };

    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return result;
  },
};
