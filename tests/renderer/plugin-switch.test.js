// lib/plugin-switch.js: the one on/off switch in a plug-in's settings dialog
// (#1498 step 2). Each kind of plug-in keeps what "on" already meant, so the
// switch changes exactly what the old controls (the "Use X" switch, the
// footer's Enable/Done, the body "Enable X" switches) changed.
const fs = require('fs');
const path = require('path');
const { pluginSwitchState, metadataSwitchState, playbackSwitchState, recommendationsSwitchState, keyLabel } = require('../../src/renderer/lib/plugin-switch');

// A plug-in as the loader gives it: its manifest's fields, capabilities and settings.
const plugin = (id) => {
  const m = require(`../../plugins-src/${id}/manifest.json`);
  return { ...(m.manifest || m), capabilities: m.capabilities, settings: m.settings };
};

describe('music plug-ins: on = in the active list', () => {
  test('Spotify follows activeResolvers and is never disabled', () => {
    expect(pluginSwitchState({ plugin: plugin('spotify'), config: {}, activeResolvers: ['spotify'] })).toEqual({ checked: true, disabled: false, hint: 'Include it in search' });
    expect(pluginSwitchState({ plugin: plugin('spotify'), config: {}, activeResolvers: [] }).checked).toBe(false);
  });
});

describe('AI and concert plug-ins that need a key', () => {
  test('no key: off and disabled, saying what to add first', () => {
    expect(pluginSwitchState({ plugin: plugin('chatgpt'), config: {} })).toEqual({ checked: false, disabled: true, hint: 'Add your API key below first' });
    expect(pluginSwitchState({ plugin: plugin('bandsintown'), config: {} }).hint).toBe('Add your App ID below first');
    expect(pluginSwitchState({ plugin: plugin('seatgeek'), config: {} }).hint).toBe('Add your Client ID below first');
  });
  test('with a key it is on until switched off (isServiceEnabled / getConcertServices)', () => {
    expect(pluginSwitchState({ plugin: plugin('chatgpt'), config: { apiKey: 'sk-x' } })).toEqual({ checked: true, disabled: false, hint: 'Use with Shuffleupagus' });
    expect(pluginSwitchState({ plugin: plugin('chatgpt'), config: { apiKey: 'sk-x', enabled: false } }).checked).toBe(false);
    expect(pluginSwitchState({ plugin: plugin('bandsintown'), config: { appId: 'a' } })).toEqual({ checked: true, disabled: false, hint: 'Include in Concerts' });
  });
});

describe('AI plug-ins that need no key (Ollama, Custom LLM): on = enabled: true', () => {
  test('off until switched on; a key alone does not turn it on', () => {
    expect(pluginSwitchState({ plugin: plugin('ollama'), config: {} })).toEqual({ checked: false, disabled: false, hint: 'Use with Shuffleupagus' });
    expect(pluginSwitchState({ plugin: plugin('ollama'), config: { enabled: true } }).checked).toBe(true);
    expect(pluginSwitchState({ plugin: plugin('customllm'), config: { apiKey: 'k' } }).checked).toBe(false);
  });
});

describe('everything else: enabled, or set up and not switched off; never disabled', () => {
  test('Last.fm is on by its fresh-install default, before any username', () => {
    expect(pluginSwitchState({ plugin: plugin('lastfm'), config: { enabled: true } })).toEqual({ checked: true, disabled: false, hint: 'Use for recommendations and your history' });
    expect(pluginSwitchState({ plugin: plugin('lastfm'), config: { enabled: false } })).toEqual({ checked: false, disabled: false, hint: 'Use for recommendations and your history' });
  });
  test('ListenBrainz is on once set up, unless switched off', () => {
    expect(pluginSwitchState({ plugin: plugin('listenbrainz'), config: { username: 'u' } }).checked).toBe(true);
    expect(pluginSwitchState({ plugin: plugin('listenbrainz'), config: { username: 'u', enabled: false } }).checked).toBe(false);
    expect(pluginSwitchState({ plugin: plugin('listenbrainz'), config: {} }).disabled).toBe(false);
  });
  test('Libre.fm only scrobbles, and says so', () => {
    expect(pluginSwitchState({ plugin: plugin('librefm'), config: {} }).hint).toBe('Scrobble what you play');
  });
  test('Wikipedia and Discogs are on unless switched off (an old install has no `enabled`)', () => {
    expect(pluginSwitchState({ plugin: plugin('discogs'), config: undefined }).checked).toBe(true);
    expect(pluginSwitchState({ plugin: plugin('discogs'), config: {} }).checked).toBe(true);
    expect(pluginSwitchState({ plugin: plugin('discogs'), config: { enabled: false } }).checked).toBe(false);
  });
  test('Wikipedia and Discogs serve artist info; Achordion has no hint', () => {
    expect(pluginSwitchState({ plugin: plugin('wikipedia'), config: { enabled: true } })).toEqual({ checked: true, disabled: false, hint: 'Artist biographies and photos' });
    expect(pluginSwitchState({ plugin: plugin('achordion'), config: {} })).toEqual({ checked: false, disabled: false, hint: '' });
  });
});

test('field labels read in sentence case', () => {
  expect(keyLabel({ settings: { configurable: { apiKey: { label: 'API Key' } } } })).toBe('API key');
  expect(keyLabel({ settings: { configurable: { clientId: { label: 'Client ID' } } } })).toBe('Client ID');
});

test('the dialog has one on/off control: the switch, and a footer that only closes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/plugin-settings-dialog.js'), 'utf8');
  expect(src).toContain('pluginSwitchState({ plugin: selectedResolver, config: metaServiceConfigs[id], activeResolvers })');
  expect(src).not.toMatch(/showEnable|'Enable Ollama'/);
  // "Enable X" is the one switch's label (#1505); a second one would be a copy.
  expect((src.match(/`Enable \$\{selectedResolver\.name\}`/g) || []).length).toBe(1);
  expect(src).toContain("React.createElement(Button, { variant: 'primary', onClick: () => setSelectedResolver(null) }, 'Done')");
  expect((src.match(/React\.createElement\(Switch, \{ checked: state\.checked/g) || []).length).toBe(1);
});

describe('"Play from X" under a music plug-in\'s "Use X" (#1505)', () => {
  test('shown only for a music plug-in that is on', () => {
    expect(playbackSwitchState({ plugin: plugin('spotify'), active: true }).shown).toBe(true);
    expect(playbackSwitchState({ plugin: plugin('spotify'), active: false }).shown).toBe(false);
    expect(playbackSwitchState({ plugin: plugin('lastfm'), active: true }).shown).toBe(false);
  });
  test('on by default; off is the user\'s "search, covers and links only"', () => {
    expect(playbackSwitchState({ plugin: plugin('youtube'), active: true })).toEqual({ shown: true, checked: true, disabled: false, hint: 'Plays tracks, in your priority order' });
    expect(playbackSwitchState({ plugin: plugin('youtube'), active: true, playbackOff: true })).toMatchObject({ checked: false, disabled: false });
  });
  test('a plan limit switches it off and locks it, saying why', () => {
    const limit = { blocked: true, label: 'Prime: no playback', message: 'Playing Amazon tracks in Parachord needs Music Unlimited.' };
    expect(playbackSwitchState({ plugin: plugin('amazonmusic'), active: true, limit }))
      .toEqual({ shown: true, checked: false, disabled: true, hint: 'Playing Amazon tracks in Parachord needs Music Unlimited.' });
  });
});

describe('"Recommendations from X" (#1505)', () => {
  test('shown for an on plug-in that offers recommendations, music or not', () => {
    expect(recommendationsSwitchState({ plugin: plugin('amazonmusic'), active: true }).shown).toBe(true);
    expect(recommendationsSwitchState({ plugin: plugin('lastfm'), active: true }).shown).toBe(true);
    expect(recommendationsSwitchState({ plugin: plugin('spotify'), active: true }).shown).toBe(false);
    expect(recommendationsSwitchState({ plugin: plugin('amazonmusic'), active: false }).shown).toBe(false);
  });
  test('on by default; off leaves its picks out', () => {
    expect(recommendationsSwitchState({ plugin: plugin('amazonmusic'), active: true }).checked).toBe(true);
    expect(recommendationsSwitchState({ plugin: plugin('amazonmusic'), active: true, recommendationsOff: true }).checked).toBe(false);
  });
});

test('app.js leaves a switched-off provider out of Recommendations, and reloads when it changes', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/\.filter\(r => !recommendationsOffRef\.current\.includes\(r\.id\)\)/);
  expect(app).toContain('metaServices, recommendationsOffResolvers]);');
});

describe('"Use metadata from X" (#1505)', () => {
  test('shown for an enabled music plug-in; on by default', () => {
    expect(metadataSwitchState({ plugin: plugin('spotify'), active: true })).toEqual({ shown: true, checked: true, hint: 'Album covers and artist photos' });
    expect(metadataSwitchState({ plugin: plugin('spotify'), active: true, metadataOff: true }).checked).toBe(false);
    expect(metadataSwitchState({ plugin: plugin('wikipedia'), active: true }).shown).toBe(false);
    expect(metadataSwitchState({ plugin: plugin('spotify'), active: false }).shown).toBe(false);
  });
  test('app.js: covers and artist photos skip a plug-in whose metadata is off; track search does not', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
    expect(app).toContain("const activeIds = (activeResolversRef.current || []).filter(id => !(requireAlbumArt && metadataOffRef.current.includes(id)));");
    expect(app).toContain("const activeIds = (activeResolversRef.current || []).filter(id => !metadataOffRef.current.includes(id));");
  });
});
