// Source of truth for plugins/ollama.axe v1.1.1.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  chat: async function (messages, tools, config) {
    const endpoint = config.endpoint || 'http://localhost:11434';
    const model = config.model || 'llama3.1';

    // Convert tools to Ollama format (same as OpenAI)
    const ollamaTools =
      tools && tools.length > 0
        ? tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    // Build request body
    const body = {
      model: model,
      messages: messages,
      stream: false,
    };

    // Only include tools if we have them
    if (ollamaTools && ollamaTools.length > 0) {
      body.tools = ollamaTools;
    }

    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Ollama error (${response.status}): ${text}`);
    }

    const data = await response.json();

    // Parse tool calls if present
    let toolCalls = null;
    if (data.message && data.message.tool_calls && data.message.tool_calls.length > 0) {
      toolCalls = data.message.tool_calls.map((tc) => {
        // Ollama returns tool calls with function.name and function.arguments
        const args =
          typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
        return {
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          name: tc.function.name,
          arguments: args,
        };
      });
    }

    return {
      content: data.message?.content || '',
      toolCalls: toolCalls,
    };
  },
  listModels: async function (config) {
    const endpoint = config.endpoint || 'http://localhost:11434';
    const response = await fetch(`${endpoint}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = data.models || [];
    return models.map((m) => ({
      value: m.name,
      label: `${m.name} (${Math.round((m.size || 0) / 1e9)}B)`,
    }));
  },
  testConnection: async function (config) {
    const endpoint = config.endpoint || 'http://localhost:11434';
    try {
      const response = await fetch(`${endpoint}/api/tags`);
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      const models = data.models || [];
      return {
        success: true,
        models: models.map((m) => m.name),
        message: `Connected. ${models.length} model(s) available.`,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Connection failed',
      };
    }
  },
};
