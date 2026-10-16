// Source of truth for plugins/customllm.axe v1.1.1.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  chat: async function (messages, tools, config) {
    const baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Set a Base URL for your custom endpoint in settings');

    const model = (config.model || '').trim();
    if (!model) throw new Error('Set a model for your custom endpoint in settings');

    const api = (config.api || 'openai').toLowerCase();
    const isAnthropic = api === 'anthropic' || api === 'anthropic-messages';
    const maxTokens = parseInt(config.maxTokens, 10);
    // Reasoning effort for thinking models (GLM, Qwen3, DeepSeek-R1, ...).
    // 'auto' (default) sends nothing, so the request is exactly what 1.0.x sent
    // and endpoints that make reasoning mandatory (some OpenRouter models reject
    // effort 'none') keep working; 'off' best-effort disables thinking; a
    // concrete level requests that much thinking.
    const effort = (config.reasoningEffort || 'auto').toLowerCase();

    const formatError = (text, status) => {
      let msg = 'Custom LLM error (' + status + ')';
      try {
        const errData = JSON.parse(text);
        msg = errData.error?.message || errData.message || msg;
      } catch (e) {
        if (text) msg = text.slice(0, 300);
      }
      if (status === 404) {
        msg += isAnthropic
          ? '. Check your Base URL - the Anthropic Messages path (/v1/messages) is appended automatically.'
          : '. Check your Base URL - OpenAI-compatible endpoints usually need the /v1 path (e.g. http://localhost:1234/v1).';
      }
      return msg;
    };

    // Maps the abstract effort level onto the endpoint's native reasoning knobs.
    // Same shape as the pi harness's thinking-format handling: detect the API
    // family from the base URL, then speak its dialect. Unknown hosts (vLLM,
    // llama.cpp, LM Studio, SGLang, ...) take the generic chat-template switch.
    const applyReasoning = (body) => {
      if (isAnthropic) {
        // Extended thinking is opt-in and needs a token budget below max_tokens.
        // Not on turns that can call tools: Anthropic requires the thinking
        // blocks to be sent back unchanged with the assistant's tool_use turn,
        // and the chat service rebuilds that turn from content + tool calls
        // only, so the follow-up request after a tool call would 400. The
        // tool-less paths (generate, Home suggestions) still get thinking.
        if (tools && tools.length > 0) return;
        if (effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high') {
          const budget = { minimal: 1024, low: 2048, medium: 4096, high: 8192 }[effort];
          body.thinking = { type: 'enabled', budget_tokens: budget };
          if (body.max_tokens <= budget) body.max_tokens = budget + 1024;
        }
        return;
      }
      const u = baseUrl.toLowerCase();
      if (u.includes('api.x.ai')) {
        // Grok rejects reasoning_effort on most models - send nothing, like pi.
      } else if (u.includes('openrouter.ai')) {
        if (effort === 'off') body.reasoning = { effort: 'none' };
        else if (effort !== 'auto') body.reasoning = { effort: effort };
      } else if (u.includes('api.together.ai') || u.includes('api.together.xyz')) {
        if (effort === 'off') body.reasoning = { enabled: false };
        else if (effort !== 'auto') {
          body.reasoning = { enabled: true };
          body.reasoning_effort = effort;
        }
      } else if (u.includes('deepseek.com')) {
        if (effort === 'off') body.thinking = { type: 'disabled' };
        else if (effort !== 'auto') body.thinking = { type: 'enabled' };
      } else if (u.includes('api.z.ai') || u.includes('open.bigmodel.cn')) {
        if (effort === 'off') body.thinking = { type: 'disabled' };
        else if (effort !== 'auto') body.thinking = { type: 'enabled', clear_thinking: false };
      } else if (
        u.includes('api.openai.com') ||
        u.includes('openai.azure.com') ||
        u.includes('api.mistral.ai') ||
        u.includes('groq.com') ||
        u.includes('cerebras.ai')
      ) {
        // Hosted OpenAI-style APIs validate the body strictly, so 'off' sends nothing.
        if (effort !== 'off' && effort !== 'auto') body.reasoning_effort = effort;
      } else {
        // Generic OpenAI-compatible server (vLLM, llama.cpp, LM Studio, SGLang, ...).
        // chat_template_kwargs is the native vLLM/SGLang switch (vLLM filters
        // enable_thinking out when the model's chat template doesn't declare it;
        // llama.cpp/LM Studio ignore unknown fields). 'off' must actually disable
        // thinking: hybrid models otherwise reason away the whole response budget
        // and return null content.
        if (effort === 'off') {
          body.chat_template_kwargs = { enable_thinking: false };
        } else if (effort !== 'auto') {
          body.reasoning_effort = effort;
          body.chat_template_kwargs = { enable_thinking: true };
        }
      }
    };

    if (isAnthropic) {
      // Anthropic Messages dialect
      let systemPrompt = '';
      const apiMessages = [];

      for (const msg of messages) {
        if (msg.role === 'system') {
          systemPrompt += (systemPrompt ? '\n\n' : '') + (msg.content || '');
        } else if (msg.role === 'user') {
          apiMessages.push({ role: 'user', content: msg.content });
        } else if (msg.role === 'assistant') {
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            const content = [];
            if (msg.content) content.push({ type: 'text', text: msg.content });
            for (const tc of msg.tool_calls) {
              let input = {};
              if (typeof tc.arguments === 'string') {
                try {
                  input = JSON.parse(tc.arguments);
                } catch (e) {
                  input = {};
                }
              } else if (tc.arguments && typeof tc.arguments === 'object') {
                input = tc.arguments;
              }
              content.push({
                type: 'tool_use',
                id: tc.id || tc.name,
                name: tc.name,
                input: input,
              });
            }
            apiMessages.push({ role: 'assistant', content });
          } else {
            apiMessages.push({ role: 'assistant', content: msg.content });
          }
        } else if (msg.role === 'tool') {
          apiMessages.push({
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

      const body = {
        model: model,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1024,
        messages: apiMessages,
      };
      if (systemPrompt) body.system = systemPrompt;

      if (tools && tools.length > 0) {
        body.tools = tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      applyReasoning(body);

      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      };
      if (config.apiKey) headers['x-api-key'] = config.apiKey;

      const response = await fetch(baseUrl + '/v1/messages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatError(text, response.status));
      }

      const data = await response.json();

      let content = '';
      let toolCalls = null;
      let sawThinking = false;
      if (data.content && Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'thinking') {
            sawThinking = true;
          } else if (block.type === 'text') {
            content += block.text;
          } else if (block.type === 'tool_use') {
            if (!toolCalls) toolCalls = [];
            toolCalls.push({ id: block.id, name: block.name, arguments: block.input });
          }
        }
      }

      // Extended thinking can consume the whole budget (stop_reason "max_tokens")
      // leaving only thinking blocks - surface it instead of an empty reply.
      if (!content && !toolCalls && sawThinking) {
        throw new Error(
          data.stop_reason === 'max_tokens'
            ? 'Model spent its entire token budget thinking and produced no answer (stop_reason "max_tokens"). Raise Max Tokens or set Reasoning to Off.'
            : 'Model returned only thinking with no answer. Set Reasoning to Off or a lower effort.',
        );
      }

      return { content: content, toolCalls: toolCalls };
    }

    // OpenAI chat/completions dialect
    const openaiTools =
      tools && tools.length > 0
        ? tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
        : undefined;

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

    const body = {
      model: model,
      messages: openaiMessages,
      temperature: 0.7,
    };
    if (openaiTools && openaiTools.length > 0) {
      body.tools = openaiTools;
      body.tool_choice = 'auto';
    }
    if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

    applyReasoning(body);

    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(formatError(text, response.status));
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    // Reasoning models behind a reasoning parser (vLLM, DeepSeek) put
    // chain-of-thought in a sibling reasoning/reasoning_content field and leave
    // content null until reasoning finishes - surface that loudly instead of
    // returning an empty reply.
    const reasoningText = message?.reasoning || message?.reasoning_content;
    if (!message?.content && !message?.tool_calls?.length && reasoningText) {
      const finish = data.choices?.[0]?.finish_reason;
      throw new Error(
        finish === 'length'
          ? 'Model spent its entire token budget reasoning and produced no answer (finish_reason "length"). Raise Max Tokens or set Reasoning to Off.'
          : 'Model returned only reasoning with no answer. Set Reasoning to Off or a lower effort.',
      );
    }

    const result = {
      content: message?.content || '',
      toolCalls: null,
    };

    if (message?.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map((tc) => {
        let args = {};
        try {
          args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments || {};
        } catch (e) {
          // Some local servers emit malformed JSON arguments - degrade to no args
          args = {};
        }
        return {
          id: tc.id || 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
          name: tc.function.name,
          arguments: args,
        };
      });
    }

    return result;
  },
  generate: async function (prompt, config, listeningContext) {
    const baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Set a Base URL for your custom endpoint in settings');

    const model = (config.model || '').trim();
    if (!model) throw new Error('Set a model for your custom endpoint in settings');

    const api = (config.api || 'openai').toLowerCase();
    const isAnthropic = api === 'anthropic' || api === 'anthropic-messages';
    const maxTokens = parseInt(config.maxTokens, 10);
    // Reasoning effort: 'auto' (default) sends nothing, 'off' best-effort
    // disables thinking, or a concrete level (minimal/low/medium/high).
    const effort = (config.reasoningEffort || 'auto').toLowerCase();

    let systemPrompt =
      'You are a music expert. Generate a playlist based on the user\'s request. Return ONLY a JSON array of objects with "title" and "artist" fields. No explanations, just the JSON array. Example: [{"title": "Song Name", "artist": "Artist Name"}]';

    if (listeningContext) {
      systemPrompt +=
        "\n\nUser's listening history for context:\n" + JSON.stringify(listeningContext);
    }

    const formatError = (text, status) => {
      let msg = 'Custom LLM error (' + status + ')';
      try {
        const errData = JSON.parse(text);
        msg = errData.error?.message || errData.message || msg;
      } catch (e) {
        if (text) msg = text.slice(0, 300);
      }
      if (status === 404) {
        msg += isAnthropic
          ? '. Check your Base URL - the Anthropic Messages path (/v1/messages) is appended automatically.'
          : '. Check your Base URL - OpenAI-compatible endpoints usually need the /v1 path (e.g. http://localhost:1234/v1).';
      }
      return msg;
    };

    // Maps the abstract effort level onto the endpoint's native reasoning knobs
    // (same dialect detection as chat()).
    const applyReasoning = (body) => {
      if (isAnthropic) {
        if (effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high') {
          const budget = { minimal: 1024, low: 2048, medium: 4096, high: 8192 }[effort];
          body.thinking = { type: 'enabled', budget_tokens: budget };
          if (body.max_tokens <= budget) body.max_tokens = budget + 1024;
        }
        return;
      }
      const u = baseUrl.toLowerCase();
      if (u.includes('api.x.ai')) {
        // Grok rejects reasoning_effort on most models - send nothing, like pi.
      } else if (u.includes('openrouter.ai')) {
        if (effort === 'off') body.reasoning = { effort: 'none' };
        else if (effort !== 'auto') body.reasoning = { effort: effort };
      } else if (u.includes('api.together.ai') || u.includes('api.together.xyz')) {
        if (effort === 'off') body.reasoning = { enabled: false };
        else if (effort !== 'auto') {
          body.reasoning = { enabled: true };
          body.reasoning_effort = effort;
        }
      } else if (u.includes('deepseek.com')) {
        if (effort === 'off') body.thinking = { type: 'disabled' };
        else if (effort !== 'auto') body.thinking = { type: 'enabled' };
      } else if (u.includes('api.z.ai') || u.includes('open.bigmodel.cn')) {
        if (effort === 'off') body.thinking = { type: 'disabled' };
        else if (effort !== 'auto') body.thinking = { type: 'enabled', clear_thinking: false };
      } else if (
        u.includes('api.openai.com') ||
        u.includes('openai.azure.com') ||
        u.includes('api.mistral.ai') ||
        u.includes('groq.com') ||
        u.includes('cerebras.ai')
      ) {
        if (effort !== 'off' && effort !== 'auto') body.reasoning_effort = effort;
      } else {
        if (effort === 'off') {
          body.chat_template_kwargs = { enable_thinking: false };
        } else if (effort !== 'auto') {
          body.reasoning_effort = effort;
          body.chat_template_kwargs = { enable_thinking: true };
        }
      }
    };

    let content;
    if (isAnthropic) {
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      };
      if (config.apiKey) headers['x-api-key'] = config.apiKey;

      const body = {
        model: model,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      };

      applyReasoning(body);

      const response = await fetch(baseUrl + '/v1/messages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatError(text, response.status));
      }

      const data = await response.json();
      const textBlocks = (data.content || []).filter((b) => b.type === 'text');
      const sawThinking = (data.content || []).some((b) => b.type === 'thinking');

      // Extended thinking can consume the whole budget leaving only thinking
      // blocks - surface it instead of silently returning an empty playlist.
      if (textBlocks.length === 0 && sawThinking) {
        throw new Error(
          data.stop_reason === 'max_tokens'
            ? 'Model spent its entire token budget thinking and produced no answer (stop_reason "max_tokens"). Raise Max Tokens or set Reasoning to Off.'
            : 'Model returned only thinking with no answer. Set Reasoning to Off or a lower effort.',
        );
      }

      content = textBlocks.map((b) => b.text).join('');
    } else {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;

      const body = {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      };
      if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

      applyReasoning(body);

      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(formatError(text, response.status));
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;

      // Reasoning models behind a reasoning parser put chain-of-thought in a
      // sibling reasoning field and leave content null - surface it instead of
      // silently returning an empty playlist.
      const reasoningText = message?.reasoning || message?.reasoning_content;
      if (!message?.content && reasoningText) {
        const finish = data.choices?.[0]?.finish_reason;
        throw new Error(
          finish === 'length'
            ? 'Model spent its entire token budget reasoning and produced no answer (finish_reason "length"). Raise Max Tokens or set Reasoning to Off.'
            : 'Model returned only reasoning with no answer. Set Reasoning to Off or a lower effort.',
        );
      }

      content = message?.content || '[]';
    }

    try {
      const jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
      return JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse custom LLM response:', content);
      throw new Error('Could not parse playlist from response');
    }
  },
  listModels: async function (config) {
    const baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Set a Base URL first');

    const api = (config.api || 'openai').toLowerCase();
    const isAnthropic = api === 'anthropic' || api === 'anthropic-messages';

    let url,
      headers = {};
    if (isAnthropic) {
      url = baseUrl + '/v1/models';
      headers['anthropic-version'] = '2023-06-01';
      if (config.apiKey) headers['x-api-key'] = config.apiKey;
    } else {
      url = baseUrl + '/models';
      if (config.apiKey) headers['Authorization'] = 'Bearer ' + config.apiKey;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const data = await response.json();
    const models = data.data || data.models || [];
    return models
      .map((m) => {
        const id = m.id || m.name;
        return {
          value: id,
          label: m.display_name ? id + ' (' + m.display_name + ')' : id,
        };
      })
      .filter((m) => m.value);
  },
};
