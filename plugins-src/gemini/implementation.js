// Source of truth for plugins/gemini.axe v2.3.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  generate: async function (prompt, config, listeningContext) {
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error('Google AI API key not configured');

    const model = config.model || 'gemini-2.5-flash';

    let systemInstruction =
      'You are a music expert. Generate a playlist based on the user\'s request. Return ONLY a JSON array of objects with "title" and "artist" fields. No explanations, just the JSON array.';

    if (listeningContext) {
      systemInstruction +=
        "\n\nUser's listening history for context:\n" + JSON.stringify(listeningContext);
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7 },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      let msg = error.error?.message || `Gemini API error: ${response.status}`;
      if (
        msg.indexOf('has not been used in project') !== -1 ||
        msg.indexOf('SERVICE_DISABLED') !== -1
      ) {
        msg =
          'Your Gemini API key needs the Generative Language API enabled on its backing Google Cloud project. If you got your key from Google AI Studio (https://aistudio.google.com/app/apikey), try regenerating it — auto-enable should fire on creation. Otherwise click the link below to enable the API on the existing project.\n\n' +
          msg;
      }
      throw new Error(msg);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    try {
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse Gemini response:', content);
      throw new Error('Could not parse playlist from response');
    }
  },
  listModels: async function (config) {
    const apiKey = config.apiKey;
    if (!apiKey) return [];
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const models = (data.models || [])
      .filter(
        (m) =>
          m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'),
      )
      .filter((m) => !m.name.includes('embedding') && !m.name.includes('aqa'))
      .filter((m) => !/-\d{3}$|exp|tuning|learnlm|preview|gemini-1\.0/.test(m.name))
      .map((m) => ({
        value: m.name.replace('models/', ''),
        label: m.displayName || m.name.replace('models/', ''),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return models;
  },
  chat: async function (messages, tools, config) {
    const apiKey = config.apiKey;
    if (!apiKey) throw new Error('Google AI API key not configured');

    const model = config.model || 'gemini-2.5-flash';

    // Convert messages to Gemini format
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.name || msg.tool_call_id || 'unknown',
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    // Convert tools to Gemini format. An empty functionDeclarations list is
    // not a valid tool, so a caller that wants a plain answer sends none.
    const geminiTools =
      tools && tools.length > 0
        ? [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            },
          ]
        : undefined;

    const requestBody = {
      contents: contents,
      generationConfig: { temperature: 0.7 },
    };

    if (systemInstruction) {
      requestBody.system_instruction = systemInstruction;
    }

    if (geminiTools) {
      requestBody.tools = geminiTools;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      let msg = error.error?.message || `Gemini API error: ${response.status}`;
      if (
        msg.indexOf('has not been used in project') !== -1 ||
        msg.indexOf('SERVICE_DISABLED') !== -1
      ) {
        msg =
          'Your Gemini API key needs the Generative Language API enabled on its backing Google Cloud project. If you got your key from Google AI Studio (https://aistudio.google.com/app/apikey), try regenerating it — auto-enable should fire on creation. Otherwise click the link below to enable the API on the existing project.\n\n' +
          msg;
      }
      throw new Error(msg);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const result = {
      content: '',
      toolCalls: null,
    };

    for (const part of parts) {
      if (part.text) {
        result.content += part.text;
      }
      if (part.functionCall) {
        if (!result.toolCalls) result.toolCalls = [];
        result.toolCalls.push({
          id: `call_${Date.now()}_${result.toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }

    return result;
  },
};
