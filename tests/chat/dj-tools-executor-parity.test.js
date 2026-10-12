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
