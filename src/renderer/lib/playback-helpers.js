/**
 * Small error-path helper trio, module-scope everywhere (extracted during the
 * slice-3 review per maintainer feedback: the extraction had copied them into
 * the hook and left the app.js originals in place, and two copies of a pure
 * helper are two chances to drift). Both the hook and app.js now require()
 * this single source.
 */

const unsupportedAudioMessage = (ext) => {
  const e = (ext || '').toLowerCase();
  if (e === 'flac' || e === 'wav') {
    return `This ${e.toUpperCase()} file could not be decoded. It may be damaged, incompletely downloaded, or an unusual variant of the format. Hi-res files (24-bit, up to 192 kHz) are supported, so there is no need to downsample; try re-ripping or re-downloading it.`;
  }
  if (e === 'mp3') {
    return 'This MP3 file appears corrupted or uses an unsupported variant. Try re-encoding it with a standard MP3 encoder.';
  }
  if (e === 'ogg' || e === 'oga' || e === 'opus' || e === 'aac' || e === 'm4a') {
    return `This ${e.toUpperCase()} file is corrupted or uses an unsupported variant. Try converting it to FLAC or MP3.`;
  }
  if (e === 'wma' || e === 'aiff' || e === 'aif' || e === 'alac' || e === 'ape' || e === 'dsf' || e === 'dff') {
    return `${e.toUpperCase()} is not supported by the built-in player. Convert it to FLAC (lossless) or MP3.`;
  }
  return `This ${e ? e.toUpperCase() : 'audio'} file uses an unsupported format. Try converting it to FLAC or MP3.`;
};

function dropSubsonicSecrets(record) {
  if (!record || typeof record !== 'object') return;
  delete record.subsonicStreamUrl;
  if (typeof record.albumArt === 'string' && record.albumArt.includes('/rest/getCoverArt')) {
    delete record.albumArt;
  }
};

function playbackDurationSeconds(source, track) {
  const direct = Number(source && source.duration) || Number(track && track.duration) || 0;
  if (direct > 0) return direct;
  const length = Number(track && track.length) || Number(source && source.length) || 0;
  return length > 0 ? Math.max(1, Math.round(length / 1000)) : 0;
}

module.exports = {
  unsupportedAudioMessage,
  dropSubsonicSecrets,
  playbackDurationSeconds,
};
