/**
 * Two executors exist: tools/dj-tools.js (the registry the MCP server
 * advertises, with per-tool execute() wrappers) and executeDjTool in app.js
 * (what the MCP handler and the AI chat actually dispatch through). #857 added
 * seek / get_position / block_recommendation to the registry and its tests but
 * never to the app.js switch, so every call answered "Unknown tool" for four
 * months. This fails whenever a registry tool has no case in app.js.
 */

const fs = require('fs');
const path = require('path');
const { djTools } = require('../../tools/dj-tools');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

function appExecutorSource() {
  const start = app.indexOf('const executeDjTool = async (name, args, context) => {');
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf("return { success: false, error: `Unknown tool: ${name}` };", start);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

describe('app.js executeDjTool covers every tool in the dj-tools registry', () => {
  const src = appExecutorSource();
  const cases = new Set([...src.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));

  test('registry parses', () => {
    expect(djTools.length).toBeGreaterThan(10);
  });

  test.each(djTools.map((t) => [t.name]))('%s has a case in app.js', (name) => {
    expect(cases.has(name)).toBe(true);
  });

  test('the MCP tool context wires seek, get_position and block_recommendation to real functions', () => {
    // The context handed to executeDjTool by the MCP IPC handler.
    const idx = app.indexOf('blockRecommendation: addToRecommendationBlocklist,');
    expect(idx).toBeGreaterThan(-1);
    expect(app).not.toMatch(/blockRecommendation: \(\) => \{\}/);
    expect(app).toMatch(/handleSeek: async \(offsetMs\) =>/);
    expect(app).toMatch(/getCurrentPosition: \(\) =>/);
  });
});

// parachord#1007: the inline chat tool list told the model about
// block_recommendation in the system prompt but never offered the tool.
describe('the inline chat tool list (app.js djTools) matches the registry', () => {
  const start = app.indexOf('const djTools = [');
  const end = app.indexOf('\n];', start);
  const inline = new Set([...app.slice(start, end).matchAll(/^\s{4}name: '([a-z_]+)'/gm)].map((m) => m[1]));
  const executorCases = new Set([...appExecutorSource().matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));

  // seek / get_position are for external clients (MCP); the in-app model
  // has the playbar. queue_remove / collection_radio are chat-only today.
  const mcpOnly = new Set(['seek', 'get_position']);

  test.each(djTools.filter((t) => !mcpOnly.has(t.name)).map((t) => [t.name]))('%s is offered to the in-app chat model', (name) => {
    expect(inline.has(name)).toBe(true);
  });

  test.each([...inline].map((n) => [n]))('%s (inline) has an executor case', (name) => {
    expect(executorCases.has(name)).toBe(true);
  });

  test('the system prompt and the tool list agree about block_recommendation', () => {
    expect(app).toMatch(/Call the block_recommendation tool IMMEDIATELY/);
    expect(inline.has('block_recommendation')).toBe(true);
  });
});

// parachord#1008: every context.<method> that app.js's executeDjTool (the
// executor both the MCP handler and the chat actually dispatch through) calls
// must exist on the MCP tool context, or the tool is advertised but broken.
describe('the MCP tool context provides every context method executeDjTool uses', () => {
  const needed = new Set([...appExecutorSource().matchAll(/context\.([a-zA-Z]+)\(/g)].map((m) => m[1]));

  const mcpStart = app.indexOf('window.electron.mcp.onToolCall(async ({ requestId, toolName, args }) => {');
  expect(mcpStart).toBeGreaterThan(-1);
  const mcpEnd = app.indexOf('const result = await executeDjTool(toolName, args, context);', mcpStart);
  const mcpSrc = app.slice(mcpStart, mcpEnd);

  const sharedStart = app.indexOf('const buildPlaylistToolContext = () => ({');
  expect(sharedStart).toBeGreaterThan(-1);
  const sharedSrc = app.slice(sharedStart, app.indexOf('\n  });', sharedStart));
  expect(mcpSrc).toContain('...buildPlaylistToolContext()');

  // Chat-only: the data-sharing gate (the MCP server is its own opt-in) and
  // startCollectionRadio / removeFromQueue (collection_radio and queue_remove
  // are not advertised over MCP).
  const chatOnly = new Set(['isDataSharingEnabled', 'startCollectionRadio', 'removeFromQueue']);

  test('the executor uses a non-trivial set of context methods', () => {
    expect(needed.size).toBeGreaterThan(10);
  });

  test.each([...needed].filter((n) => !chatOnly.has(n)).map((n) => [n]))('context.%s is provided', (name) => {
    const re = new RegExp(`(^|[\\s,{])${name}: `, 'm');
    expect(re.test(mcpSrc) || re.test(sharedSrc)).toBe(true);
  });
});
