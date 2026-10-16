// Source of truth for plugins/claude.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  chat: async function (messages, tools, config) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }

    const model = config.model || 'claude-sonnet-4-20250514';

    // Convert messages to Claude format
    // Claude uses 'user' and 'assistant' roles, system goes separately
    let systemPrompt = '';
    const claudeMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        claudeMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        // Handle assistant messages with tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const content = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id || tc.name,
              name: tc.name,
              input: tc.arguments,
            });
          }
          claudeMessages.push({ role: 'assistant', content });
        } else {
          claudeMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Tool results go as user messages with tool_result content
        claudeMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content,
            },
          ],
        });
      }
    }

    // Convert tools to Claude format
    const claudeTools =
      tools && tools.length > 0
        ? tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          }))
        : undefined;

    // Build request
    const body = {
      model: model,
      max_tokens: 1024,
      messages: claudeMessages,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (claudeTools && claudeTools.length > 0) {
      body.tools = claudeTools;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      // Parse error response for user-friendly message
      try {
        const errorData = JSON.parse(text);
        const errorMsg = errorData.error?.message || errorData.message || text;
        const errorType = errorData.error?.type || '';

        // Map common errors to friendly messages
        if (errorType === 'authentication_error' || errorMsg.includes('invalid x-api-key')) {
          throw new Error('Invalid API key. Please check your Claude API key in settings.');
        }
        if (errorType === 'invalid_request_error' && errorMsg.includes('credit')) {
          throw new Error(
            'No API credits remaining. Please add credits to your Anthropic account.',
          );
        }
        if (response.status === 429) {
          throw new Error('Rate limit reached. Please wait a moment and try again.');
        }
        if (response.status === 529 || errorMsg.includes('overloaded')) {
          throw new Error('Claude is currently overloaded. Please try again in a few moments.');
        }
        throw new Error(errorMsg);
      } catch (parseErr) {
        if (parseErr.message && !parseErr.message.includes('JSON')) {
          throw parseErr;
        }
        throw new Error(`Claude API error (${response.status})`);
      }
    }

    const data = await response.json();

    // Parse response
    let content = '';
    let toolCalls = null;

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          if (!toolCalls) toolCalls = [];
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input,
          });
        }
      }
    }

    return {
      content: content,
      toolCalls: toolCalls,
    };
  },
};
