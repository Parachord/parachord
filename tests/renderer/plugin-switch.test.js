// lib/plugin-switch.js: the one on/off switch in a plug-in's settings dialog
// (#1498 step 2). Each kind of plug-in keeps what "on" already meant, so the
// switch changes exactly what the old controls (the "Use X" switch, the
// footer's Enable/Done, the body "Enable X" switches) changed.
const fs = require('fs');
const path = require('path');
const { pluginSwitchState, keyLabel } = require('../../src/renderer/lib/plugin-switch');

// A plug-in as the loader gives it: its manifest's fields, capabilities and settings.
const plugin = (id) => {
  const m = require(`../../plugins-src/${id}/manifest.json`);
  return { ...(m.manifest || m), capabilities: m.capabilities, settings: m.settings };
};

describe('music plug-ins: on = in the active list', () => {
  test('Spotify follows activeResolvers and is never disabled', () => {
    expect(pluginSwitchState({ plugin: plugin('spotify'), config: {}, activeResolvers: ['spotify'] })).toEqual({ checked: true, disabled: false, hint: 'Include in search and playback' });
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
  test('Wikipedia and Discogs serve artist info; Achordion has no hint', () => {
    expect(pluginSwitchState({ plugin: plugin('wikipedia'), config: { enabled: true } })).toEqual({ checked: true, disabled: false, hint: 'Use for artist info' });
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
  expect(src).not.toMatch(/showEnable|'Enable Ollama'|`Enable \$\{selectedResolver/);
  expect(src).toContain("React.createElement(Button, { variant: 'primary', onClick: () => setSelectedResolver(null) }, 'Done')");
  expect((src.match(/React\.createElement\(Switch, \{ checked: state\.checked/g) || []).length).toBe(1);
});
