// bandcamp-embed-control.js: the script that runs INSIDE Bandcamp's embedded
// player. Bandcamp's embed has no control protocol (SoundCloud's widget does),
// so this drives the page's own <audio> element directly.
//
// It is a plain script on purpose: the mobile apps evaluate a byte-for-byte
// copy in their hidden web views, the way they carry soundcloud-widget-player.js.
// Edit it here and copy it to them. It runs in a third-party page's own world,
// so anything it reports is treated as untrusted by whoever reads it.
//
//   bcStart()        clicks the play button, returns true if it found one
//   bcState()        JSON: { audio, hasSrc, paused, ended, t, dur, errorCode,
//                    decodedBytes }, with t and dur in seconds and
//                    decodedBytes the element's webkitAudioDecodedByteCount
//                    (the compressed audio bytes decoded so far — the
//                    measured-bitrate input; null when the page's element
//                    doesn't expose it)
//   bcPlay()  bcPause()  bcSeek(seconds)  bcVolume(0..1)

function bcAudio() {
  return document.querySelector('audio');
}

// `ended` is latched because the page may move on by itself once a track ends:
// a poll that came a moment later would miss it, and the queue would never
// advance. Anything else showing up in the element counts as the end too.
function bcWatch(el) {
  if (!el) return null;
  if (window.__bcWatch && window.__bcWatch.el === el) return window.__bcWatch;
  const watch = { el: el, ended: false, src: '' };
  el.addEventListener('ended', function () { watch.ended = true; });
  window.__bcWatch = watch;
  return watch;
}

function bcStart() {
  // #big_play_button, not .embeddedplaybutton: that one is a 0x0 element that
  // loads no stream when clicked.
  const button = document.querySelector('#big_play_button');
  if (!button) return false;
  bcWatch(bcAudio());
  button.click();
  return true;
}

function bcState() {
  const el = bcAudio();
  if (!el) return JSON.stringify({ audio: false, hasSrc: false, paused: true, ended: false, t: 0, dur: 0, errorCode: null, decodedBytes: null });
  const watch = bcWatch(el);
  if (el.src) {
    if (!watch.src) {
      watch.src = el.src;
    } else if (watch.src !== el.src && !watch.ended) {
      watch.ended = true;
      el.pause();
    }
  }
  // A number off the element like t and dur — the caller treats it as
  // untrusted and sanitizes it like the rest of the state.
  const decodedBytes = typeof el.webkitAudioDecodedByteCount === 'number' && el.webkitAudioDecodedByteCount >= 0
    ? el.webkitAudioDecodedByteCount
    : null;
  return JSON.stringify({
    audio: true,
    hasSrc: !!el.src,
    paused: !!el.paused,
    ended: !!(watch.ended || el.ended),
    t: Number(el.currentTime) || 0,
    dur: Number(el.duration) || 0,
    errorCode: el.error ? el.error.code : null,
    decodedBytes: decodedBytes
  });
}

function bcPlay() {
  const el = bcAudio();
  if (el) el.play();
  return !!el;
}

function bcPause() {
  const el = bcAudio();
  if (el) el.pause();
  return !!el;
}

function bcSeek(seconds) {
  const el = bcAudio();
  if (el) el.currentTime = seconds;
  return !!el;
}

function bcVolume(volume) {
  const el = bcAudio();
  if (el) el.volume = volume;
  return !!el;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bcStart, bcState, bcPlay, bcPause, bcSeek, bcVolume };
}
