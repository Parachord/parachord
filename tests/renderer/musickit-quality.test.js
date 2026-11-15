/**
 * Apple Music follows the global Quality setting (#1396 follow-up):
 * MusicKit JS has two bitrates, so Data saver picks the standard one and
 * every other level the high one.
 */
const fs = require('fs');
const path = require('path');
const { MusicKitWeb, musicKitBitrateForQuality } = require('../../musickit-web');

test('Data saver is the standard bitrate; every other level is high', () => {
  expect(musicKitBitrateForQuality('saver')).toBe(64);
  for (const q of ['standard', 'high', 'max', undefined]) expect(musicKitBitrateForQuality(q)).toBe(256);
});

test('setQuality sets the bitrate now, and again after configure', () => {
  const mk = new MusicKitWeb();
  mk.setQuality('saver'); // not configured yet: remembered
  expect(mk.preferredBitrate).toBe(64);
  mk.musicKit = { bitrate: 256 };
  mk._applyBitrate();
  expect(mk.musicKit.bitrate).toBe(64);
  mk.setQuality('max');
  expect(mk.musicKit.bitrate).toBe(256);
});

test('a MusicKit without a bitrate property is left alone', () => {
  const mk = new MusicKitWeb();
  mk.musicKit = {};
  mk.setQuality('saver');
  expect('bitrate' in mk.musicKit).toBe(false);
});

test('configure applies it, and the app passes the setting on every change', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../musickit-web.js'), 'utf8');
  expect(src).toMatch(/this\.isConfigured = true;\s*this\._applyBitrate\(\);/);
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  expect(app).toMatch(/musicKitWeb\.setQuality\(playbackQuality\);\s*\}\)\(\);\s*\}, \[playbackQuality, playbackAbr, playbackSpatial, cacheLoaded, qualityLoaded\]\);/);
});
