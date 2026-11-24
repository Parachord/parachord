#!/usr/bin/env node
// scripts/ui-contact-sheet.js: screenshot every variant of a data-driven
// surface, side by side, so inconsistencies between them show.
//
// Why: the 2026-11-13 design audit read code by element type and the
// design-drift ratchet counts patterns; neither sees that one dialog does the
// same job five different ways across its variants. The plug-in settings
// dialog had 23 variants that nobody had compared until they were captured
// side by side (docs/plans/2026-11-17-plugin-settings-audit.md, #1498). An
// audit or a UI PR on a surface with per-item variants (plug-in dialogs,
// playlist types, Home's states) attaches these sheets, light and dark.
//
// Usage:
//   1. Start a dev app with a debugging port, on a throwaway profile so
//      nothing touches your real data (and quit any other Parachord first:
//      the app's ports are shared):
//        PARACHORD_USER_DATA=/tmp/parachord-sheets npm start -- --remote-debugging-port=9333
//      (Copy files into that folder first if the surface needs data, e.g.
//      store/local_playlists.json for playlist variants; the app moves it
//      into store/playlists/, a file per playlist, on its first start.)
//   2. node scripts/ui-contact-sheet.js plugin-settings [--out dir] [--port 9333] [--themes light,dark]
//
// Writes one PNG per variant per theme, summary-<theme>.json (headings,
// buttons, fields, switches and links per variant, for comparing structure,
// not just looks), and, when ImageMagick's `montage` is installed,
// sheet-<theme>-N.png contact sheets.
//
// Adding a surface: add a recipe below. A recipe has `open` (get to the
// screen that lists the variants), `variants` (their names), `show(name)`
// (open one; resolve to the element to capture) and `close`. Recipes run in
// the page as strings, so keep them self-contained.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RECIPES = {
  // Settings › Plug-Ins: every installed plug-in's settings dialog.
  'plugin-settings': {
    open: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const skip = [...document.querySelectorAll('button')].find(b => /skip tutorial/i.test(b.textContent));
      if (skip) { skip.click(); await sleep(800); }
      [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase() === 'settings').click();
      await sleep(1500);
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Plug-Ins').click();
      await sleep(2500);
    })()`,
    variants: `[...document.querySelectorAll('button[aria-label]')]
      .filter(b => b.closest('[class*=grid]') && !b.closest('nav'))
      .map(b => b.getAttribute('aria-label'))`,
    show: (name) => `(async () => {
      const b = [...document.querySelectorAll('button[aria-label]')].find(x => x.getAttribute('aria-label') === ${JSON.stringify(name)});
      if (!b) return false;
      b.click();
      await new Promise(r => setTimeout(r, 1500));
      return !!document.querySelector('[role=dialog]');
    })()`,
    target: `[...document.querySelectorAll('[role=dialog]')].pop()`,
    close: `(async () => {
      const d = [...document.querySelectorAll('[role=dialog]')].pop();
      d?.querySelector('[aria-label=Close]')?.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
    })()`,
  },
};

function args() {
  const a = process.argv.slice(2);
  const opt = { recipe: a[0], port: 9333, out: null, themes: ['light', 'dark'] };
  for (let i = 1; i < a.length; i++) {
    if (a[i] === '--port') opt.port = Number(a[++i]);
    else if (a[i] === '--out') opt.out = a[++i];
    else if (a[i] === '--themes') opt.themes = a[++i].split(',');
  }
  opt.out = opt.out || path.join(process.cwd(), 'ui-sheets', opt.recipe || '');
  return opt;
}

async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => p.type === 'page' && p.url.includes('index.html'));
  if (!page) throw new Error(`No Parachord page on port ${port}. Start the app with --remote-debugging-port=${port}.`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result && res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
    return res.result && res.result.result ? res.result.result.value : undefined;
  };
  return { ws, send, ev };
}

// What each variant is made of, for comparing structure: one job done with
// different controls shows up here even when the screenshots look similar.
const DESCRIBE = (target) => `(() => {
  const d = ${target};
  if (!d) return null;
  // Let a scrolling panel grow so the capture holds all of it.
  for (const el of [d, ...d.querySelectorAll('*')]) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY)) { el.style.maxHeight = 'none'; el.style.overflowY = 'visible'; }
  }
  const vis = (el) => el.offsetParent !== null;
  const r = d.getBoundingClientRect();
  return {
    rect: [r.x, r.y, r.width, r.height],
    headings: [...d.querySelectorAll('h1,h2,h3,h4,[class*=uppercase]')].filter(vis).map(h => h.textContent.trim().slice(0, 60)),
    buttons: [...d.querySelectorAll('button')].filter(vis).map(b => (b.textContent.trim() || b.getAttribute('aria-label') || '').slice(0, 60)),
    fields: [...d.querySelectorAll('input,select,textarea')].filter(vis).map(i => (i.type || i.tagName.toLowerCase()) + ': ' + (i.getAttribute('aria-label') || i.id || i.placeholder || '')),
    switches: [...d.querySelectorAll('[role=switch],[role=menuitemcheckbox]')].filter(vis).map(s => s.getAttribute('aria-label') || ''),
    links: [...d.querySelectorAll('a')].filter(vis).map(a => a.textContent.trim().slice(0, 60)),
  };
})()`;

async function main() {
  const opt = args();
  const recipe = RECIPES[opt.recipe];
  if (!recipe) {
    console.error(`Usage: node scripts/ui-contact-sheet.js <${Object.keys(RECIPES).join('|')}> [--out dir] [--port 9333] [--themes light,dark]`);
    process.exit(1);
  }
  fs.mkdirSync(opt.out, { recursive: true });
  const { ws, send, ev } = await connect(opt.port);
  // A tall viewport so a long variant fits in one capture.
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 2600, deviceScaleFactor: 1, mobile: false });
  const wasDark = await ev(`document.documentElement.classList.contains('dark')`);
  try {
    await ev(recipe.open);
    const names = await ev(recipe.variants);
    for (const theme of opt.themes) {
      // The app's theme setting toggles <html class="dark">; flip it directly.
      await ev(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`);
      const summary = [];
      const shots = [];
      for (const name of names) {
        if (!(await ev(recipe.show(name)))) { summary.push({ name, opened: false }); continue; }
        const info = await ev(DESCRIBE(recipe.target));
        if (info) {
          const [x, y, w, h] = info.rect;
          const file = path.join(opt.out, `${theme}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}.png`);
          const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: Math.min(h, 2560), scale: 1 } });
          if (shot.result) { fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64')); shots.push(file); }
          summary.push({ name, ...info });
        }
        await ev(recipe.close);
      }
      fs.writeFileSync(path.join(opt.out, `summary-${theme}.json`), JSON.stringify(summary, null, 1));
      // Contact sheets, five to a row, when ImageMagick is installed.
      try {
        for (let i = 0; i < shots.length; i += 5) {
          execFileSync('montage', [...shots.slice(i, i + 5), '-tile', '5x1', '-geometry', '380x+12+12', '-background', theme === 'dark' ? '#111827' : '#d1d5db', '-gravity', 'north',
            path.join(opt.out, `sheet-${theme}-${i / 5 + 1}.png`)], { stdio: 'ignore' });
        }
      } catch { /* no ImageMagick: the single shots are there */ }
      console.log(`${theme}: ${shots.length} of ${names.length} variants captured`);
    }
  } finally {
    // Put the theme back the way it was.
    await ev(`document.documentElement.classList.toggle('dark', ${wasDark})`).catch(() => {});
    await send('Emulation.clearDeviceMetricsOverride', {});
    ws.close();
  }
  console.log(`Wrote ${opt.out}`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
