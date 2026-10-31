/**
 * Engine-wiring structural guards — the blockers a render-smoke probe can't
 * see. dartSlice-3's straight-move passed early gates while its wiring layer
 * was broken four ways (found in review round 1). These tests assert the
 * invariants directly:
 *
 * 1. Every DIRECT ctx literal slot member (a name that is NOT a ref-bridge,
 *    i.e. doesn't end in `Ref`) resolves to a declaration ABOVE the ctx
 *    literal in src/renderer/app.js. A literal evaluating a shorthand name
 *    declared below its line is a temporal-dead-zone ReferenceError on the
 *    first render — the class that escaped all prior gates (browser-only,
 *    invisible to eslint/jest/esbuild).
 * 2. The engine call passes every app-side value/ref the hook's signature
 *    requires (streamingPlaybackActiveRef, spotifyToken, extensionConnected,
 *    audioContext) — the "engine writes a ref never passed" class.
 * 3. The volume-hook call passes isPlayingRef (the volume panic path reads
 *    it without optional chaining; dropped from the call → TypeError).
 *
 * Marker practice for hooks never parses the whole engine constructor — the
 * input-destructure probes handle that side (use-playback-engine.test.js).
 */

const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const lines = appSrc.split('\n');
const lineNo = (needle, after = 0) => {
  const idx = appSrc.indexOf(needle, after);
  if (idx === -1) throw new Error('marker not found: ' + needle);
  return appSrc.slice(0, idx).split('\n').length;
};

const ctxLine = lineNo('  const ctx = {');
const engineCallLine = lineNo('} = usePlaybackEngine({');
const volumeCallLine = lineNo('  const volumeDomain = useVolume({');

function declaredAbove(name, line) {
  const patterns = [
    new RegExp(`^ {2}const \\[${name}, \\w+\\] = useState`, 'm'),
    new RegExp(`^ {2}const \\[\\w+, ${name}\\] = useState`, 'm'), // state setters
    new RegExp(`^  const ${name} = `, 'm'),
    new RegExp(`^  const ${name} = useRef`, 'm'),
    new RegExp(`^  const ${name} = (?:async )?(?:\\(|useCallback)`, 'm'),
  ];
  for (const re of patterns) {
    const m = appSrc.match(re);
    if (m) {
      const declLine = appSrc.slice(0, m.index).split('\n').length;
      if (declLine < line) return true;
    }
  }
  return false;
}

describe('engine ctx literal ordering (TDZ guards)', () => {
  // DIRECT shorthand members of the ctx literal — everything not ending in
  // `Ref` must have a declaration STRICTLY above the literal.
  const DIRECT_SLOTS = {
    resolvers: [
      'loadedResolversRef', 'activeResolversRef', 'resolverOrderRef', 'resolverBlocklistRef',
      'resolverConfigCache', 'isHtml5StreamResolver', 'findLoadedResolver', 'usesSharedAudio',
      'resolveTracksInBackground', 'buildProtocolFetchHeaders', 'lastfmFetch', 'getLastfmApiKey',
    ],
    enrichment: [
      'trackSources', 'queueTrackSources', 'lookupMbidMapper', 'enrichTrackWithMbid',
      'fetchArtworkViaMbid', 'forgetMissingLocalFile',
    ],
    ui: ['showConfirmDialog', 'setActiveView', 'setSettingsTab', 'setProgress'],
  };

  test.each(Object.entries(DIRECT_SLOTS).flatMap(([slot, names]) => names.map((n) => [slot, n])))(
    'ctx.%s.%s is declared above the ctx literal',
    (slot, name) => {
      expect(declaredAbove(name, ctxLine)).toBe(true);
    },
  );

  // B3-class guard: every expected slot must be PRESENT inside the ctx
  // literal — declared-above alone lets a member slip silently out of the
  // literal (the B3 class from review round 1).
  const ctxOpen = appSrc.indexOf('  const ctx = {');
  const ctxClose = appSrc.indexOf('  };', ctxOpen);
  const ctxBody = appSrc.slice(ctxOpen, ctxClose);
  const ALL_SLOTS = Object.values(DIRECT_SLOTS).flat().concat([
    'getResolverConfigRef', 'resolveTrackRef', 'confidenceForSourceRef',
    'getAlbumArtRef', 'getCachedAlbumArtRef', 'showExternalTrackPromptUIRef',
    'showToastRef', 'updateSchedulerVisibilityRef', 'abortSchedulerContextRef',
    'registerPoolContextRef', 'setSchedulerPlaybackIndexRef',
    'getArtistTopTracksRef', 'keyForSpinoffDedupRef', 'refreshSpotifyTokenRef', 'startAutoAdvancePollingRef',
  ]);
  test.each(ALL_SLOTS.map((n) => [n]))('%s is present in the ctx literal', (name) => {
    expect(ctxBody).toContain(name + ',');
  });

  // The REF-bridge members (`...Ref` — refs synced post-declaration by design)
  // must each have a useRef declaration ANYWHERE (shape never positions).
  const REF_SLOTS = [
    'getResolverConfigRef', 'resolveTrackRef', 'confidenceForSourceRef',
    'getAlbumArtRef', 'getCachedAlbumArtRef', 'showExternalTrackPromptUIRef',
    'showToastRef', 'updateSchedulerVisibilityRef', 'abortSchedulerContextRef',
    'registerPoolContextRef', 'setSchedulerPlaybackIndexRef',
    'getArtistTopTracksRef', 'keyForSpinoffDedupRef', 'refreshSpotifyTokenRef', 'startAutoAdvancePollingRef',
  ];
  test.each(REF_SLOTS)('%s has a useRef declaration and a per-render sync', (name) => {
    expect(appSrc).toMatch(new RegExp(`const ${name} = useRef\\(null\\);`));
    // Synced on at least one no-dep every-render line; the cluster nests the
    // assignment inside a larger effect in a few places, so tolerate any
    // 'name.current = fn' line rather than one exact effect shape.
    const fnName = name.replace(/Ref$/, '');
    expect(appSrc).toMatch(new RegExp(`${name}\\.current = ${fnName};`));
  });
});

describe('engine + volume call-surface completeness', () => {
  test('engine call passes the app-side values/refs the hook requires', () => {
    const callIdx = appSrc.indexOf('} = usePlaybackEngine({');
    const argArea = appSrc.slice(callIdx, callIdx + 2200);
    for (const name of ['streamingPlaybackActiveRef', 'spotifyToken', 'extensionConnected', 'audioContext', 'isPlayingRef', 'handlePlayRef']) {
      expect(argArea).toContain(name + ',');
    }
  });

  test('volume-hook call passes isPlayingRef (fatal regression class)', () => {
    const volumeArgs = appSrc.slice(appSrc.indexOf('const volumeDomain = useVolume({'), appSrc.indexOf('const volumeDomain = useVolume({') + 400);
    expect(volumeArgs).toContain('isPlayingRef,');
  });
});


describe('every engine-call argument is declared above the call (the spotifyProgressBaselineRef boot crash, maintained)', () => {
  const espree = require('espree');
  const fsAst = require('fs');
  const pathAst = require('path');
  const appSource = fsAst.readFileSync(pathAst.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

  function parseApp() {
    return espree.parse(appSource, { ecmaVersion: 2022, sourceType: 'script', loc: true });
  }

  function findCallNode(program) {
    let found = null;
    function walk(node) {
      if (!node || typeof node !== 'object' || found) return;
      if (Array.isArray(node)) { for (const n of node) walk(n); return; }
      if (node.type === 'VariableDeclarator' && node.init && node.init.type === 'CallExpression'
          && node.init.callee && node.init.callee.name === 'usePlaybackEngine') {
        found = node;
        return;
      }
      for (const k of Object.keys(node)) walk(node[k]);
    }
    walk(program);
    return found;
  }

  function topLevelDeclPositions(program) {
    // map: name → line of the top-level (module-body or Parachord-body) declaration
    const decls = new Map();
    const body = program.body;
    const parachord = body.find((n) => n.type === 'VariableDeclaration'
      && n.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === 'Parachord'));
    const innerBody = (parachord && parachord.declarations[0].init && parachord.declarations[0].init.body && parachord.declarations[0].init.body.body) || [];
    const scanTargets = [body, innerBody];
    for (const stmts of scanTargets) {
      if (!Array.isArray(stmts)) continue;
      for (const stmt of stmts) {
        if (stmt.type === 'VariableDeclaration') {
          for (const d of stmt.declarations) {
            if (d.id.type === 'Identifier' && !decls.has(d.id.name)) decls.set(d.id.name, stmt.loc.start.line);
            else if (d.id.type === 'ObjectPattern' || d.id.type === 'ArrayPattern') {
              const entries = d.id.properties || d.id.elements || [];
              for (const p of entries) {
                const key = p && (p.value ? p.value.name : p.name);
                if (key && !decls.has(key)) decls.set(key, stmt.loc.start.line);
              }
            }
          }
        } else if (stmt.type === 'FunctionDeclaration' && stmt.id && !decls.has(stmt.id.name)) {
          decls.set(stmt.id.name, stmt.loc.start.line);
        }
      }
    }
    return decls;
  }

  const GLOBALS = new Set(['window', 'document', 'console', 'Object', 'Array', 'Map', 'Set', 'Promise', 'JSON', 'Math', 'Date',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'URL', 'URLSearchParams', 'undefined', 'null', 'true', 'false', 'window_electron']);

  test('AST audit: every identifier referenced by ctx and the call args is declared above the call', () => {
    const program = parseApp();
    const callNode = findCallNode(program);
    expect(callNode).not.toBeNull();
    const decls = topLevelDeclPositions(program);
    const callLine = callNode.init.loc.start.line;
    const argObject = callNode.init.arguments[0];
    expect(argObject && argObject.type).toBe('ObjectExpression');

    // identifiers referenced in ctx's inner object + the outer call args, VALUES only
    const scopes = [];
    for (const prop of argObject.properties) {
      if (prop.type !== 'Property') continue;
      if (prop.key.name === 'ctx' && prop.value.type === 'ObjectExpression') {
        for (const slot of prop.value.properties) {
          if (slot.value.type === 'ObjectExpression') scopes.push(...slot.value.properties);
          else scopes.push(slot);
        }
      } else {
        scopes.push(prop);
      }
    }

    const offenders = [];
    for (const prop of scopes) {
      const stack = [prop.value];
      // include shorthand's key-name binding too
      if (prop.shorthand && prop.key.type === 'Identifier') {
        const name = prop.key.name;
        const line = decls.get(name);
        if (line === undefined && !GLOBALS.has(name)) offenders.push(`${name} (unresolved in Parachord top level)`);
        else if (line !== undefined && line >= callLine) offenders.push(`${name} (decl line ${line} >= call line ${callLine})`);
      }
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Array.isArray(node)) { stack.push(...node); continue; }
        if (node.type === 'Identifier') {
          const name = node.name;
          const line = decls.get(name);
          if (line === undefined) {
            if (!GLOBALS.has(name)) offenders.push(`${name} (unresolved in Parachord top level)`);
          } else if (line >= callLine) {
            offenders.push(`${name} (decl line ${line} >= call line ${callLine})`);
          }
        } else if (node.type === 'MemberExpression') { stack.push(node.object); } // skip property paths
        else if (node.type === 'ObjectExpression') { /* keys irrelevant */ for (const p of node.properties) stack.push(p.value); }
        else { for (const k of Object.keys(node)) { if (k !== 'parent') stack.push(node[k]); } }
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
