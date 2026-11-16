// Settings › Plug-ins search: typing "cha" listed Bandcamp, whose description
// says "purchase". Descriptions now match only at the start of a word.
const fs = require('fs');
const path = require('path');
const { pluginMatchesQuery } = require('../../src/renderer/lib/plugin-search');

const bandcamp = { name: 'Bandcamp', description: 'Find, play and purchase music from independent artists' };
const chatgpt = { name: 'ChatGPT', description: 'AI DJ powered by OpenAI' };
const claude = { name: 'Claude', description: 'Chat with an AI about your music' };
const spotify = { name: 'Spotify', description: 'Stream from your Spotify account' };

describe('pluginMatchesQuery', () => {
  test('"cha" matches by name and by a description word, not inside "purchase"', () => {
    expect(pluginMatchesQuery(chatgpt, 'cha')).toBe(true);
    expect(pluginMatchesQuery(claude, 'cha')).toBe(true);
    expect(pluginMatchesQuery(bandcamp, 'cha')).toBe(false);
  });

  test('name matches as a case-insensitive substring', () => {
    expect(pluginMatchesQuery(spotify, 'spot')).toBe(true);
    expect(pluginMatchesQuery(spotify, 'SPOT')).toBe(true);
    expect(pluginMatchesQuery(bandcamp, 'camp')).toBe(true);
  });

  test('description matches at word starts after punctuation', () => {
    expect(pluginMatchesQuery(bandcamp, 'purch')).toBe(true);
    expect(pluginMatchesQuery(bandcamp, 'indep')).toBe(true);
    expect(pluginMatchesQuery(bandcamp, 'play')).toBe(true);
  });

  test('accepts Unicode letters', () => {
    const p = { name: 'X', description: 'Música électronique' };
    expect(pluginMatchesQuery(p, 'élec')).toBe(true);
    expect(pluginMatchesQuery(p, 'mús')).toBe(true);
    expect(pluginMatchesQuery(p, 'sica')).toBe(false);
  });

  test('an empty query matches everything', () => {
    for (const p of [bandcamp, chatgpt, spotify, {}]) {
      expect(pluginMatchesQuery(p, '')).toBe(true);
      expect(pluginMatchesQuery(p, '   ')).toBe(true);
      expect(pluginMatchesQuery(p, undefined)).toBe(true);
    }
  });

  test('a missing description only matches by name', () => {
    expect(pluginMatchesQuery({ name: 'Tidal' }, 'tid')).toBe(true);
    expect(pluginMatchesQuery({ name: 'Tidal' }, 'x')).toBe(false);
  });
});

describe('app.js uses the helper for both plug-in lists', () => {
  const src = require('../helpers/renderer-source').appWithPages();
  test('no substring match on plug-in descriptions remains', () => {
    expect(src).not.toMatch(/\.description \|\| ''\)\.toLowerCase\(\)\.includes\(query\)/);
    expect((src.match(/pluginMatchesQuery\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
