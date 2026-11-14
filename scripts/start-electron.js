#!/usr/bin/env node
// Launches the app for `npm start` and `npm run dev` (arguments after `--`
// pass through, e.g. `npm start -- --remote-debugging-port=9333`).
//
// Why not electron's own launcher (`electron .`): it forwards every SIGINT
// to the app. Ctrl+C in a terminal already sends SIGINT to the whole process
// group, the app included, and Electron answers a first SIGINT with its
// normal quit (before-quit, which pauses Spotify) but dies on a second. So the
// app got two and died partway through the quit step, and Spotify kept playing
// with nothing in control (2026-11-14).
//
// This launcher forwards a signal only if the app is still running after
// FORWARD_GRACE_MS, which covers a signal sent to the launcher alone (a
// `kill <pid>` of npm's child) without cutting a Ctrl+C quit short.

'use strict';

// Longer than the quit step: the Spotify pause is bounded at 5 s
// (QUIT_PAUSE_BUDGET_MS in main-process/quit-cleanup.js).
const FORWARD_GRACE_MS = 8000;

function launch({ spawnFn, proc, binary }) {
  const child = spawnFn(binary, ['.', ...proc.argv.slice(2)], { stdio: 'inherit' });
  let closed = false;
  child.on('close', (code, signal) => {
    closed = true;
    if (code === null) {
      console.error(binary, 'exited with signal', signal);
      proc.exit(1);
      return;
    }
    proc.exit(code);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    proc.on(signal, () => {
      setTimeout(() => {
        if (!closed) child.kill(signal);
      }, FORWARD_GRACE_MS);
    });
  }
  return child;
}

if (require.main === module) {
  launch({
    spawnFn: require('child_process').spawn,
    proc: process,
    // The electron package's main export is the path to the binary.
    binary: require('electron')
  });
}

module.exports = { launch, FORWARD_GRACE_MS };
