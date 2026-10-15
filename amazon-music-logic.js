// Pure helpers for the Amazon Music resolver. Kept out of main.js so the
// review fixes (wrong-ASIN play, empty-string match, seek-vs-end, duration
// units, sign-in page detection) can be tested without Electron.

// The <video> element reports duration in seconds; the poller stores
// milliseconds. Search-result duration is seconds and is converted by the
// poller (`duration * 1000`), not here. Do not guess: a "< 1000 means
// seconds" heuristic turns a 20-minute track reported in seconds into 1.2s,
// and a short ms value into a multi-minute one.
function playerDurationMs(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

// Advance only in the last poll window, not 4s early. The app's own
// autoplay wraps position to ~0; a backward seek does not.
const NEAR_END_MS = 700;
const WRAP_POSITION_MS = 2500;
const FAST_POLL_REMAINING_MS = 8000;
// A page torn down while paused (element removed after the user paused via
// media keys and the page idled out) polls EMPTY with lastState PAUSED — dead,
// unresumable, and previously stuck in {action:'track'} forever. Give the
// pause a generous grace window (~60s at the 2s cadence), then treat it like
// any other dead player.
const EMPTY_WHILE_PAUSED_POLL_LIMIT = 30;

function decidePollAdvance({
  state,
  positionMs = 0,
  durationMs = 0,
  lastPositionMs = 0,
  lastState = null,
  expectedAsin = null,
  actualAsin = null,
  pollCount = 0,
  seekSuppress = false,
  emptyWhilePausedPolls = 0
} = {}) {
  if (actualAsin && expectedAsin && actualAsin !== expectedAsin) {
    if (pollCount <= 2) return { action: 'wait' };
    return { action: 'advance', reason: 'track-changed' };
  }

  if (state === 'PLAYING') {
    const remaining = durationMs > 0 ? durationMs - positionMs : Infinity;
    if (!seekSuppress && durationMs > 0 && remaining <= NEAR_END_MS && remaining >= 0) {
      return { action: 'advance', reason: 'near-end' };
    }
    const lastPercent = durationMs > 0 ? (lastPositionMs / durationMs) * 100 : 0;
    if (!seekSuppress && lastPositionMs > 5000 && positionMs < WRAP_POSITION_MS && lastPercent >= 80) {
      return { action: 'advance', reason: 'finished' };
    }
    return { action: 'continue', updateLast: true };
  }

  if (lastState === 'PLAYING' && (state === 'STOPPED' || state === 'EMPTY' || state === 'FINISHED')) {
    const lastPercent = durationMs > 0 ? (lastPositionMs / durationMs) * 100 : 0;
    const percent = durationMs > 0 ? (positionMs / durationMs) * 100 : lastPercent;
    if (lastPercent >= 90 || percent >= 90) return { action: 'advance', reason: 'finished' };
    return { action: 'advance', reason: 'stopped' };
  }

  // A page torn down while paused: EMPTY with lastState PAUSED is dead and
  // cannot be resumed. The caller latches the pause-death (the 'track' action
  // overwrites lastState with the dead value on the first such poll, so
  // gating on lastState === 'PAUSED' here used to make the grace window
  // unreachable — the counter could never be spent). The count is only ever
  // nonzero when the caller saw PAUSED before the death, so it is the
  // authority here. A never-alive player sends 0 and never advances.
  if ((state === 'EMPTY' || state === 'STOPPED' || state === 'FINISHED') &&
      emptyWhilePausedPolls >= EMPTY_WHILE_PAUSED_POLL_LIMIT) {
    return { action: 'advance', reason: 'stopped' };
  }

  return { action: 'track' };
}

function shouldPollFaster(durationMs, positionMs) {
  if (!durationMs || durationMs <= 0) return false;
  return durationMs - positionMs <= FAST_POLL_REMAINING_MS && durationMs - positionMs >= 0;
}

// ── Measured stream bitrate ──────────────────────────────────────────────────
// The poller pairs consecutive PLAYING reads of the media element's audio
// decode counter (webkitAudioDecodedByteCount — demuxed compressed stream
// bytes, so this measures the delivered stream, not PCM) and takes the median
// of the per-pair rates. A whole-file average (bytes / position) is wrong
// twice over: the decoder runs ahead of the playhead while its buffers fill,
// and a seek never resets the counter. Steady pairs — playhead advancing in
// step with the wall clock, no seek, no pause — converge on the true bitrate,
// and the median window shrugs off the startup overshoot and stall dips.
const QUALITY_PAIR_WINDOW = 8;     // pair rates kept in the median window
const QUALITY_MIN_PAIRS = 6;       // steady pairs before a measurement reports
const QUALITY_MIN_PAIR_MS = 250;   // a shorter pair (jittery/duplicate read) means nothing
const QUALITY_MAX_PAIR_MS = 4000;  // a longer pair spans a dropped poll — skip it
const QUALITY_MAX_DRIFT_MS = 400;  // |playheadΔ − wallΔ| beyond this is a seek or pause
const QUALITY_MIN_KBPS = 16;       // sanity bounds — outside is a transient, not the stream
const QUALITY_MAX_KBPS = 10000;

// samples: [{ wallMs, positionMs, bytes }] as recorded by the poller (bytes
// may be null on reads where the element exposed no counter — those just never
// form pairs). Returns kbps, or null while too few steady pairs exist.
function measuredStreamKbps(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const rates = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const next = list[i];
    if (!prev || !next) continue;
    const wallMs = (next.wallMs || 0) - (prev.wallMs || 0);
    const posMs = (next.positionMs || 0) - (prev.positionMs || 0);
    const bytes = (next.bytes || 0) - (prev.bytes || 0);
    if (wallMs < QUALITY_MIN_PAIR_MS || wallMs > QUALITY_MAX_PAIR_MS) continue;
    if (Math.abs(posMs - wallMs) > QUALITY_MAX_DRIFT_MS) continue;
    if (bytes <= 0) continue; // nothing decoded in the window (counter missing / stall)
    const kbps = Math.round((bytes * 8) / posMs);
    if (kbps < QUALITY_MIN_KBPS || kbps > QUALITY_MAX_KBPS) continue;
    rates.push(kbps);
  }
  if (rates.length < QUALITY_MIN_PAIRS) return null;
  const window = rates.slice(-QUALITY_PAIR_WINDOW).sort((a, b) => a - b);
  const mid = window.length >> 1;
  return window.length % 2 ? window[mid] : Math.round((window[mid - 1] + window[mid]) / 2);
}

// ── DASH manifest → stream parameters ────────────────────────────────────────
// The preload's net hook (installAmazonStreamCapture) captures the MPD the
// page itself fetched, plus the (small) init segment responses. Everything
// below is pure parsing of what was captured — no fetching, no DOM. DASH
// attributes are packager output rather than hornet UI, so this surface is
// stable across hornet redeploys; the tolerant scan trades precision for
// rot-resistance (an unrecognized shape yields an empty list, not garbage).

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; }
    })
    .replace(/&amp;/g, '&'); // amp last: &amp;lt; stays as literal &lt; per XML
}

// attribute pairs of one opening tag ("id="x" codecs="fLaC"").
function xmlAttrMap(tagSource) {
  const attrs = {};
  const re = /([A-Za-z_][-\w:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tagSource))) attrs[m[1]] = decodeXmlEntities(m[2]);
  return attrs;
}

// Bit depth is not a standard DASH attribute, so accept it from the places a
// packager might put it, and only for the depths Amazon actually delivers.
function mpdBitDepthHint(attrs, repText) {
  for (const key of ['bitDepth', 'bitsPerSample', 'bit_depth']) {
    const v = attrs && attrs[key];
    if (v && ['16', '24', '32'].includes(String(v))) return Number(v);
  }
  const attrScan = String(repText || '').match(/\b(?:bitDepth|bitsPerSample|bit_depth)["':=\s]+(\d{1,2})\b/i);
  if (attrScan && ['16', '24', '32'].includes(attrScan[1])) return Number(attrScan[1]);
  const idScan = String((attrs && attrs.id) || '').match(/\b(16|24|32)[-_ ]?bit\b/i);
  if (idScan) return Number(idScan[1]);
  return null;
}

// MPD text → audio representations: [{ id, codec, mimeType, container,
// bandwidth, sampleRate, channels, bitDepth, initializationUrl }]. Video sets
// are excluded; audio attributes inherit from the AdaptationSet when the
// Representation omits them (per DASH). The initialization URL is the
// SegmentTemplate/SegmentList entry with $RepresentationID$/$Bandwidth$
// substituted, resolved against BaseURL — it is how the captured init
// segments pair back to representations.
function mpdAudioRepresentations(xml, mpdUrl) {
  const text = String(xml || '');
  if (!text || !/<Representation/i.test(text)) return [];
  let base = String(mpdUrl || '');
  const baseMatch = text.match(/<BaseURL[^>]*>([^<]*)<\/BaseURL>/i);
  if (baseMatch) {
    try { base = new URL(decodeXmlEntities(baseMatch[1].trim()), mpdUrl || undefined).toString(); } catch (e) { /* keep the mpd url */ }
  }
  const resolve = (rel, from) => {
    try { return new URL(rel, from || undefined).toString(); } catch (e) { return null; }
  };
  const reps = [];
  for (const set of text.split(/<AdaptationSet\b/i).slice(1)) {
    const setTagEnd = set.indexOf('>');
    if (setTagEnd === -1) continue;
    const setAttrs = xmlAttrMap(set.slice(0, setTagEnd));
    const firstRepAt = set.indexOf('<Representation');
    const setScope = firstRepAt === -1 ? set : set.slice(0, firstRepAt);
    // AdaptationSet-level SegmentTemplate initialization / SegmentList
    // Initialization / AudioChannelConfiguration apply to every rep in the set.
    const setInitTemplate =
      decodeXmlEntities((setScope.match(/<SegmentTemplate[^>]*\binitialization\s*=\s*"([^"]*)"/i) || [])[1] || '') ||
      decodeXmlEntities((setScope.match(/<Initialization[^>]*\bsourceURL\s*=\s*"([^"]*)"/i) || [])[1] || '') ||
      null;
    const setChannels = Number((setScope.match(/<AudioChannelConfiguration[^>]*\bvalue\s*=\s*"(\d+)"/i) || [])[1]) || null;
    for (const part of set.split(/<Representation\b/i).slice(1)) {
      const tagEnd = part.indexOf('>');
      if (tagEnd === -1) continue;
      const attrs = xmlAttrMap(part.slice(0, tagEnd));
      const repClose = part.indexOf('</Representation>');
      const repScope = repClose === -1 ? part : part.slice(0, repClose);
      const mimeType = attrs.mimeType || setAttrs.mimeType || null;
      const codec = attrs.codecs || setAttrs.codecs || null;
      const isVideo = /^video\//i.test(String(mimeType || '')) || /^(avc|hev|hvc|av01)/i.test(String(codec || ''));
      if (isVideo) continue;
      if (mimeType && !/^audio\//i.test(mimeType)) continue;
      const repBaseMatch = repScope.match(/<BaseURL[^>]*>([^<]*)<\/BaseURL>/i);
      let repBase = base;
      if (repBaseMatch) {
        const resolved = resolve(decodeXmlEntities(repBaseMatch[1].trim()), base);
        if (resolved) repBase = resolved;
      }
      const initTemplate =
        decodeXmlEntities((repScope.match(/<SegmentTemplate[^>]*\binitialization\s*=\s*"([^"]*)"/i) || [])[1] || '') ||
        decodeXmlEntities((repScope.match(/<Initialization[^>]*\bsourceURL\s*=\s*"([^"]*)"/i) || [])[1] || '') ||
        setInitTemplate;
      let initializationUrl = null;
      if (initTemplate && repBase) {
        const substituted = String(initTemplate)
          .replace(/\$RepresentationID\$/g, String(attrs.id || ''))
          .replace(/\$Bandwidth\$/g, String(attrs.bandwidth || ''));
        initializationUrl = resolve(substituted, repBase);
      }
      const channels = Number((repScope.match(/<AudioChannelConfiguration[^>]*\bvalue\s*=\s*"(\d+)"/i) || [])[1]) || setChannels;
      reps.push({
        id: attrs.id || null,
        codec: codec || null,
        mimeType: mimeType || null,
        container: mimeType ? String(mimeType.split('/')[1] || '').toLowerCase() || null : null,
        bandwidth: Number(attrs.bandwidth) || null,
        sampleRate: Number(attrs.audioSamplingRate) || Number(setAttrs.audioSamplingRate) || null,
        channels: channels || null,
        bitDepth: mpdBitDepthHint(attrs, repScope) || mpdBitDepthHint(setAttrs, setScope),
        initializationUrl
      });
    }
  }
  return reps;
}

// FLAC-in-ISOBMFF init segments carry STREAMINFO in a `dfla` box — the same
// bytes the decoder reads, so this is the authoritative sample rate / bit
// depth / channels for the delivered stream. ISOBMFF boxes nest, so scan for
// the `dfla` fourcc instead of walking the box tree, and let the STREAMINFO
// sanity checks reject a coincidental byte sequence.
function flacStreamInfo(s) {
  const sampleRate = (s[10] << 12) | (s[11] << 4) | (s[12] >> 4);
  const channels = ((s[12] >> 1) & 0x07) + 1;
  const bits = (((s[12] & 0x01) << 4) | (s[13] >> 4)) + 1;
  const info = { codec: 'fLaC' };
  if (sampleRate >= 8000 && sampleRate <= 768000) info.sampleRate = sampleRate;
  if (channels >= 1 && channels <= 8) info.channels = channels;
  if (bits >= 8 && bits <= 32) info.bitDepth = bits;
  return (info.sampleRate && info.bitDepth) ? info : null;
}

function flacStreamInfoFromInit(data) {
  try {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!b || b.length < 42 || b.length > 262144) return null;
    // The FLAC specific box is 'dfla' per the FLAC-in-ISOBMFF spec, but
    // Amazon's muxer writes 'dfLa' (observed live, 2026-10-15: an enca entry
    // whose frma is 'fLaC' carrying the box as 64 66 4C 61). Scan both
    // spellings — the box nests inside stsd/enca, so scan for the fourcc
    // rather than walking the box tree, and let the STREAMINFO sanity checks
    // reject a coincidental byte sequence.
    for (const fourcc of ['dfla', 'dfLa']) {
      let pos = 0;
      while (pos < b.length) {
        const at = b.indexOf(fourcc, pos, 'utf8');
        if (at === -1) break;
        pos = at + 1;
        const info = flacStreamInfoAt(b, at);
        if (info) return info;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// dfla is a FullBox: 4 version/flags bytes, then the FLAC metadata block
// (4-byte block header + 34-byte STREAMINFO). Tolerate a muxer that omits the
// FullBox bytes.
function flacStreamInfoAt(b, at) {
  for (const blockHeaderAt of [at + 8, at + 4]) {
    // With the metadata block header…
    if (blockHeaderAt + 38 <= b.length) {
      const blockType = b[blockHeaderAt] & 0x7f;
      const blockLen = (b[blockHeaderAt + 1] << 16) | (b[blockHeaderAt + 2] << 8) | b[blockHeaderAt + 3];
      if (blockType === 0 && blockLen === 34) {
        const info = flacStreamInfo(b.subarray(blockHeaderAt + 4, blockHeaderAt + 38));
        if (info) return info;
      }
    }
    // …or bare STREAMINFO right there.
    if (blockHeaderAt + 34 <= b.length) {
      const info = flacStreamInfo(b.subarray(blockHeaderAt, blockHeaderAt + 34));
      if (info) return info;
    }
  }
  return null;
}

// Pair captured init segments with representations: exact URL match first (a
// URL-matched init read the actual init segment for that representation, so
// its STREAMINFO is authoritative over MPD attributes); otherwise the common
// single-representation pairing fills only missing fields.
function attachInitStreamInfo(reps, inits) {
  const list = (Array.isArray(reps) ? reps : []).map(r => ({ ...r }));
  const initList = (Array.isArray(inits) ? inits : []).filter(i => i && i.sampleRate);
  if (!initList.length) return list;
  const used = new Set();
  const apply = (rep, init, authoritative) => {
    used.add(init);
    if (authoritative) {
      if (init.sampleRate) rep.sampleRate = init.sampleRate;
      if (init.bitDepth) rep.bitDepth = init.bitDepth;
      if (init.channels) rep.channels = init.channels;
    } else {
      rep.sampleRate = rep.sampleRate || init.sampleRate;
      rep.bitDepth = rep.bitDepth || init.bitDepth || null;
      rep.channels = rep.channels || init.channels || null;
    }
    if (!rep.codec && init.codec) rep.codec = init.codec;
  };
  const sameUrl = (a, b) => {
    if (!a || !b) return false;
    if (a === b) return true;
    try { return new URL(a).origin + new URL(a).pathname === new URL(b).origin + new URL(b).pathname; } catch (e) { return false; }
  };
  for (const rep of list) {
    if (!rep.initializationUrl) continue;
    const hit = initList.find(i => !used.has(i) && i.url && sameUrl(i.url, rep.initializationUrl));
    if (hit) apply(rep, hit, true);
  }
  const unused = initList.filter(i => !used.has(i));
  if (unused.length === 1) {
    const flacReps = list.filter(r => !r.bitDepth && /flac/i.test(String(r.codec || '')));
    if (flacReps.length === 1) apply(flacReps[0], unused[0], false);
    else if (list.length === 1) apply(list[0], unused[0], false);
  }
  return list;
}

// Which representation is playing? The one whose bandwidth best matches the
// measured bitrate when there is a ladder to choose from; otherwise the
// single/richest one.
function pickMpdRepresentation(reps, kbps) {
  const list = (Array.isArray(reps) ? reps : []).filter(r => r && (r.codec || r.sampleRate || r.bitDepth));
  if (!list.length) return null;
  const withBw = (kbps > 0) ? list.filter(r => typeof r.bandwidth === 'number' && r.bandwidth > 0) : [];
  if (withBw.length) {
    // @bandwidth is bits per second; the measured kbps is kilobits.
    let best = withBw[0];
    let bestDist = Infinity;
    for (const r of withBw) {
      const d = Math.abs(Math.log((r.bandwidth / 1000) / kbps));
      if (d < bestDist) { bestDist = d; best = r; }
    }
    return best;
  }
  const score = (r) => (r.bitDepth ? 2 : 0) + (r.sampleRate ? 1 : 0);
  return list.reduce((a, b) => (score(b) > score(a) ? b : a));
}

// Amazon's tier vocabulary, derived from the stream's measured facts: lossy →
// SD, FLAC (or ALAC) up to 16-bit/48 kHz → HD, anything above → Ultra HD.
function amazonStreamTier({ codec, sampleRate, bitDepth } = {}) {
  const c = String(codec || '').toLowerCase();
  if (!c) return null;
  const lossless = c.includes('flac') || c.includes('alac');
  if (!lossless) return 'SD';
  if ((bitDepth && bitDepth >= 24) || (sampleRate && sampleRate > 48000)) return 'Ultra HD';
  return 'HD';
}

// The final stream-quality record (stream-quality.js contract): the measured
// bitrate plus whatever the captured manifest/init segment could prove. Fields
// are attached only when present — no fabricated FLAC/HD labels.
function amazonStreamQualityRecord(kbps, info) {
  const bitrate = Math.round(Number(kbps)) || null;
  if (!bitrate) return null;
  const rec = { bitrate, origin: 'measured' };
  const i = info || {};
  if (i.codec) rec.codec = i.codec;
  if (i.container) rec.container = i.container;
  if (i.sampleRate) rec.sampleRate = i.sampleRate;
  if (i.bitDepth) rec.bitDepth = i.bitDepth;
  if (i.channels) rec.channels = i.channels;
  const tier = amazonStreamTier(i);
  if (tier) rec.tier = tier;
  return rec;
}

// Passive network capture for the DASH manifest and the init segments,
// installed in the page world at document-start (before hornet's scripts),
// covering both the fetch and XHR paths whichever loader the player uses. It
// must never alter request behavior: wrappers call straight through, all
// observation is wrapped in try/catch, and responses are only ever cloned.
// The captured caps are read by the main process after playback confirms —
// no webRequest listeners (they are single-slot per method and would clobber
// the playlist gql capture), no refetch of signed CDN URLs.
//
// Self-contained by design: serialized with .toString() and evaluated inside
// the Amazon page (world 0), so it must not close over anything in this
// module. A literal copy lives in amazon-player-preload.js; the preload test
// enforces behavioral parity between the copies.
function installAmazonStreamCapture(scope) {
  if (!scope || scope.__parachordStreamCapture) return;
  scope.__parachordStreamCapture = true;
  const caps = { manifests: [], inits: [] };
  scope.__parachordStreamCaps = caps;
  const MAX_MANIFESTS = 4;
  const MAX_MANIFEST_CHARS = 524288;
  const MAX_INITS = 8;
  const MAX_INIT_BYTES = 65536;
  const isManifest = (url) => /\.mpd(?:[?#]|$)/i.test(String(url || ''));
  const isInitCandidate = (url) => /\.(?:mp4|m4s|cmfv|cmfa|cmf|dash)(?:[?#]|$)/i.test(String(url || ''));
  const recordManifest = (url, text) => {
    try {
      if (!text || caps.manifests.length >= MAX_MANIFESTS) return;
      caps.manifests.push({ url: String(url), text: String(text).slice(0, MAX_MANIFEST_CHARS) });
    } catch (e) {}
  };
  const recordInit = (url, buf) => {
    try {
      const n = (buf && (buf.byteLength || buf.size)) || 0;
      if (!n || n > MAX_INIT_BYTES || caps.inits.length >= MAX_INITS) return;
      caps.inits.push({ url: String(url), bytes: buf });
    } catch (e) {}
  };
  const observeResponse = (url, res) => {
    try {
      if (!res || typeof res.clone !== 'function') return;
      if (isManifest(url)) {
        res.clone().text().then((t) => recordManifest(url, t), () => {});
      } else if (isInitCandidate(url)) {
        const len = Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0;
        if (!len || len <= MAX_INIT_BYTES) res.clone().arrayBuffer().then((b) => recordInit(url, b), () => {});
      }
    } catch (e) {}
  };
  const urlOf = (input) => {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
    } catch (e) {}
    return '';
  };
  try {
    const origFetch = scope.fetch;
    if (typeof origFetch === 'function' && !origFetch.__parachordWrapped) {
      const wrappedFetch = function () {
        const url = urlOf(arguments[0]);
        const p = origFetch.apply(this, arguments);
        try {
          if (p && typeof p.then === 'function' && (isManifest(url) || isInitCandidate(url))) {
            p.then((res) => { observeResponse(url, res); return res; }, () => {});
          }
        } catch (e) {}
        return p;
      };
      try { Object.setPrototypeOf(wrappedFetch, origFetch); } catch (e) {}
      try { Object.defineProperty(wrappedFetch, '__parachordWrapped', { value: true }); } catch (e) {}
      scope.fetch = wrappedFetch;
    }
  } catch (e) {}
  try {
    const OrigXHR = scope.XMLHttpRequest;
    if (typeof OrigXHR === 'function' && !OrigXHR.__parachordWrapped) {
      const WrappedXHR = function () {
        const xhr = new OrigXHR();
        let reqUrl = '';
        try {
          const openOrig = xhr.open;
          if (typeof openOrig === 'function') {
            xhr.open = function () {
              try { reqUrl = String(arguments[1] || ''); } catch (e) {}
              return openOrig.apply(this, arguments);
            };
          }
        } catch (e) {}
        try {
          xhr.addEventListener('load', function () {
            try {
              const rt = xhr.responseType;
              if (rt === '' || rt === 'text') {
                if (isManifest(reqUrl)) recordManifest(reqUrl, xhr.responseText);
              } else if (rt === 'arraybuffer' || rt === 'blob') {
                if (isInitCandidate(reqUrl)) recordInit(reqUrl, xhr.response);
              }
            } catch (e) {}
          });
        } catch (e) {}
        return xhr;
      };
      try { WrappedXHR.prototype = OrigXHR.prototype; } catch (e) {}
      try {
        Object.keys(OrigXHR).forEach((k) => {
          try { if (!(k in WrappedXHR)) WrappedXHR[k] = OrigXHR[k]; } catch (e) {}
        });
      } catch (e) {}
      try { Object.defineProperty(WrappedXHR, '__parachordWrapped', { value: true }); } catch (e) {}
      scope.XMLHttpRequest = WrappedXHR;
    }
  } catch (e) {}
}

// castlabs components.status() shape is not a documented contract. Read only
// the status fields instead of substring-matching the whole JSON blob - an
// unrelated "failed" elsewhere in the payload (a URL, a component name) used
// to disable Amazon playback entirely. Optimistic when the shape is not
// recognized: the EME probe is the real playback gate, and a spurious
// "no CDM" disables the resolver outright. Cycle-safe.
function cdmStatusHealthy(status) {
  if (!status || typeof status !== 'object') return true;
  if (Object.keys(status).length === 0) return false; // {} = nothing installed
  const seen = new Set();
  const stack = [status];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'status') {
        const s = String(entry).toLowerCase();
        if (s === 'failed' || s.includes('component_update_error')) return false;
      } else if (entry && typeof entry === 'object') {
        stack.push(entry);
      }
    }
  }
  return true; // no status field found: assume present; the EME probe is the gate
}

// Amazon's web player is not usable for search or play while it is still
// on the account sign-in page or the post-login profile picker. Cookies can
// already exist at that point; the URL is the signal that selection finished.
function pageBlocksPlayback(url) {
  const value = url || '';
  if (/\/identity\/who-is-listening/i.test(value)) return 'not-signed-in';
  if (/\/ap\/signin/i.test(value)) return 'not-signed-in';
  return null;
}

// openLogin's completion gate. "The URL is not a known wall" alone fails
// open: music.amazon.com/ itself is not a wall, and a logged-out first paint
// can sit there (or redirect slowly) for a second or more — the old timer
// closed the sign-in window and reported success before the user touched the
// password field. Require a positive signal: a non-wall music.amazon.com URL
// that has been stable for two consecutive ticks AND at least one of (an
// auth cookie is present, the page has moved off the bare home path, or three
// stable ticks — the fallback for Amazon rotating its cookie names, at the
// cost of a ~3s wait when a signed-in landing page really is /).
function signInLanded({ url, lastUrl = null, stableTicks = 0, hasCookie = false } = {}) {
  const okUrl = !!url && /music\.amazon\.com/i.test(url) && !pageBlocksPlayback(url);
  const ticks = okUrl ? (lastUrl === url ? stableTicks + 1 : 1) : 0;
  let landed = false;
  if (ticks >= 2) {
    let path = '';
    try { path = new URL(url).pathname; } catch (e) { /* not a URL */ }
    landed = !!hasCookie || path !== '/' || ticks >= 3;
  }
  return { landed, stableTicks: ticks };
}

// Hornet's Audio Quality modal. HD and BEST_AVAILABLE both mean the
// "HD/Ultra HD" radio; the modal writes BEST_AVAILABLE. Data Saver and
// Standard are the other two radios. Auto-adjust is abrEnabled, separate
// from the radio.
const AMAZON_QUALITY_OPTIONS = [
  { value: 'BEST_AVAILABLE', label: 'HD/Ultra HD' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'DATA_SAVER', label: 'Data Saver' }
];

function normalizeStreamingQuality(value) {
  if (value === 'BEST_AVAILABLE' || value === 'HD') return 'BEST_AVAILABLE';
  if (value === 'STANDARD' || value === 'DATA_SAVER') return value;
  return null;
}

// Hornet keeps the playbackController in a Metro module; window.__r is the
// only handle, and Amazon redeploys hornet continuously, renumbering modules
// on every bundle change. Executing module factories to find it (require-by-
// id scans) runs Amazon's code out of order and can wedge the whole page —
// observed live: a renderer pegged in V8 churn with every Amazon call hanging.
// So never call __r ourselves. Instead install a trap before the bundle runs:
// when Amazon's own code requires the module, the wrapper observes the exports
// and captures the store. Self-contained by design — serialized with
// .toString() and evaluated inside the Amazon page (world 0), so it must not
// close over anything in this module.
function installAmazonRequireTrap(scope) {
  if (scope.__parachordRequireTrap) return;
  scope.__parachordRequireTrap = true;
  let current = null;
  const consider = (mod, id) => {
    try {
      const pc = mod && mod.playbackController;
      if (pc && pc.audioQualitySettings) {
        scope.__parachordAmazonPlayback = pc;
        scope.__parachordAmazonPlaybackModuleId = id;
      }
    } catch (e) {}
  };
  const wrap = (require) => {
    if (typeof require !== 'function' || require.__parachordWrapped) return require;
    const wrapped = function () {
      const mod = require.apply(this, arguments);
      consider(mod, arguments[0]);
      return mod;
    };
    // Keep require's own properties (e.g. metro's require.async) reachable
    // through the wrapper.
    try { Object.setPrototypeOf(wrapped, require); } catch (e) {}
    try { Object.defineProperty(wrapped, '__parachordWrapped', { value: true }); } catch (e) {}
    return wrapped;
  };
  try {
    // The bundle exposes __r as a global assignment, which routes through the
    // setter; a var declaration in a later script leaves the property alone.
    // If __r was already assigned before the trap installs, wrap that value.
    if (typeof scope.__r === 'function') current = wrap(scope.__r);
    Object.defineProperty(scope, '__r', {
      configurable: true,
      get() { return current; },
      set(v) { current = wrap(v); return current; }
    });
  } catch (e) {}
}

// Hornet persists the playbackController store to a localStorage entry whose
// key contains 'playback-controller' and rehydrates audioQualitySettings from
// it at boot — its persistence reaction misses nested changes while nothing
// plays, so quality writes go to both the live store and this entry. Both
// helpers take the page's localStorage so they can run inside the page world
// and be unit tested against a plain object. Self-contained by design, same
// as installAmazonRequireTrap.
function readPersistedQuality(storage) {
  try {
    const key = Object.keys(storage).find(k => k.indexOf('playback-controller') !== -1);
    if (!key) return null;
    const parsed = JSON.parse(storage.getItem(key));
    const s = parsed && parsed.data && parsed.data.audioQualitySettings;
    if (!s) return null;
    return { streamingQuality: s.streamingQuality || null, abrEnabled: !!s.abrEnabled };
  } catch (e) { return null; }
}

function writePersistedQuality(storage, settings) {
  try {
    const key = Object.keys(storage).find(k => k.indexOf('playback-controller') !== -1);
    if (!key) return false;
    const parsed = JSON.parse(storage.getItem(key));
    if (!parsed || !parsed.data) return false;
    const patch = {};
    if (settings && settings.streamingQuality != null) patch.streamingQuality = settings.streamingQuality;
    if (settings && settings.abrEnabled != null) patch.abrEnabled = !!settings.abrEnabled;
    parsed.data.audioQualitySettings = Object.assign({}, parsed.data.audioQualitySettings, patch);
    storage.setItem(key, JSON.stringify(parsed));
    return true;
  } catch (e) { return false; }
}

// Search pages also render the mini player. Its title is a /tracks/ link
// with an artist sibling, so a scrape that accepts any track link returns
// the currently playing song before the results exist. The match gate then
// rejects that hit and the track looks unresolved.
//
// Current Amazon search rows often have no SearchResults testid on the
// anchor itself. Reject player chrome by ancestor testids; on a /search/
// page keep the rest.
function asinFromPlayerUrl(url) {
  const m = (url || '').match(/\/tracks\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

// The poller compares this to the ASIN we asked to play. Echoing that
// requested ASIN makes the track-changed branch unreachable: a page that
// moved on, or a mini player showing a different track, still looks like
// the track we loaded. Never fill a missing read with the expected ASIN.
function reportedPlaybackAsin(state) {
  if (!state) return null;
  // URL first: it is the document we loaded, and the only ASIN the poller can
  // trust when the mini player disagrees. The mini player read is a scrape of
  // whatever /tracks/ link sorts first inside its chrome — a stale row or an
  // "up next" entry made actualAsin disagree with the page we are actually
  // on, and the track-changed branch skipped the track two polls in. The mini
  // player remains the fallback for surfaces with no /tracks/ URL (a queue or
  // home page) while something keeps playing; a genuine Amazon auto-advance
  // is still caught there, and near-end/wrap advance regardless.
  return asinFromPlayerUrl(state.href) || state.playingAsin || null;
}

// Playback failure must not reveal the player. Sign-in is the only window.
// A run of unplayable radio tracks used to show and focus the page.
function shouldRevealPlayerOnFailure() {
  return false;
}

function isAmazonPlayerChrome(testIds) {
  return /miniplayer|nowplaying|playbacktransport/i.test((testIds || []).join(' '));
}

// Songs-tab rows put the track ASIN on a descendant element id (the like
// button); the artist and album ASINs arrive on /artists/ and /albums/ hrefs.
// The first B-prefixed 10-char id used to win, which matched the album ASIN
// whenever it sorted earlier in the row — and the row's title and artist still
// matched, so the wrong id sailed through the confidence gate and playback
// targeted the album. Prefer an id that is not any ASIN the row links to.
function pickTrackAsinFromIds(ids, linkedAsins = []) {
  const exclude = new Set((Array.isArray(linkedAsins) ? linkedAsins : [])
    .filter(Boolean).map(a => String(a).toUpperCase()));
  for (const raw of (Array.isArray(ids) ? ids : [])) {
    if (typeof raw !== 'string') continue;
    const id = raw.toUpperCase();
    if (!/^B[A-Z0-9]{9}$/.test(id)) continue;
    if (exclude.has(id)) continue;
    return id;
  }
  return null;
}

// Search rows render durations as "N MIN M SEC" (en). Also accept "M:SS",
// "H:MM:SS" and a bare "N SEC" so the common shapes parse; anything else
// (localized, missing) is 0 — same as the old English-only parse, which
// button-scraped rows never got at all.
function parseRowDurationSec(text) {
  const s = String(text || '');
  let m = s.match(/(\d+)\s*MIN(?:\s*(\d+)\s*SEC)?/i);
  if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (m) {
    if (m[3]) return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  m = s.match(/(\d+)\s*SEC/i);
  if (m) return parseInt(m[1], 10);
  return 0;
}

// A loose "Stations Warning" search misses the song. Amazon's songs tab
// with both terms quoted does not: /search/"stations" "Warning"/songs.
function amazonSongSearchUrl({ title, artist, query, songs } = {}) {
  const quote = (value) => '"' + String(value || '').replace(/"/g, '').trim() + '"';
  let q = '';
  let songsOnly = !!songs;
  if ((title && String(title).trim()) || (artist && String(artist).trim())) {
    const parts = [];
    if (title && String(title).trim()) parts.push(quote(title));
    if (artist && String(artist).trim()) parts.push(quote(artist));
    q = parts.join(' ');
    songsOnly = true;
  } else {
    q = String(query || '').trim();
  }
  if (!q) return null;
  return 'https://music.amazon.com/search/' + encodeURIComponent(q) + (songsOnly ? '/songs' : '');
}

// The songs tab does not use SearchResultsWidget. Its rows are
// <button data-testid="HorizontalItem,undefined">. The general search
// page uses HorizontalItem,SearchResultsWidget_Item. Mini-player chrome
// is not a HorizontalItem.
function isAmazonSongResultItem(testId) {
  const id = testId || '';
  if (!/^HorizontalItem,/i.test(id)) return false;
  return !isAmazonPlayerChrome([id]);
}

function acceptAmazonSearchAnchor(testIds, onSearchPage) {
  if (isAmazonPlayerChrome(testIds)) return false;
  if (/searchresults|topresults/i.test((testIds || []).join(' '))) return true;
  return !!onSearchPage;
}

// A playlist page lives at /playlists/<id> (shared/brand playlists) or
// /my/playlists/<id> (the user's own). The id is a long alphanumeric token
// (PP…), not the 10-char ASIN a track uses — brand playlists use those too.
function amazonPlaylistIdFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/(?:my\/)?playlists\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

// Diagnostic for the lookup miss: the gql operations the page actually fired.
// When hornet renames playlistDetail, every import looks like "playlist
// deleted" — this turns that into a one-line diagnosis.
function capturedOperationNames(bodies) {
  const names = new Set();
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      if (req && req.operationName) names.add(String(req.operationName));
    }
  }
  return [...names];
}

// The page fetches its playlist via a persisted GraphQL query (APQ) against
// gql.music.amazon.com: {operationName: 'playlistDetail', variables: {id,
// firstLimit: 100, ...}, extensions: {persistedQuery: {sha256Hash}}}. The hash
// renumbers on every hornet redeploy, so we never hardcode it — we capture the
// request the page itself makes for the playlist we loaded, then replay it from
// the page world with a bigger firstLimit. Given the captured request bodies
// (strings), return the parsed playlistDetail request for OUR playlist id, or
// null when the page never made one (not found / private / other region).
function amazonPlaylistDetailRequest(bodies, playlistId) {
  const wanted = String(playlistId || '').toLowerCase();
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      if (!req || req.operationName !== 'playlistDetail') continue;
      const id = req.variables && req.variables.id;
      if (!id) continue;
      if (wanted && String(id).toLowerCase() !== wanted) continue;
      return req;
    }
  }
  return null;
}

// Headers to copy onto the replayed gql fetch. The request the page made is
// authoritative (x-api-key, csrf-*, music-territory, x-amzn-*); the browser
// adds cookies (credentials: 'include') and origin/referer/sec-* itself, and
// setting them from JS is either forbidden or wrong, so strip those.
const GQL_REPLAY_DROP_HEADERS = new Set([
  'cookie', 'origin', 'referer', 'user-agent', 'accept-encoding', 'accept-language',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'host', 'connection',
  'content-length'
]);

function amazonGqlFetchHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!GQL_REPLAY_DROP_HEADERS.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

// One tracks.edges[] entry -> the lookupPlaylist track shape. Artist is the
// joined contributing artists (PRIMARY first); album is the album shortTitle
// (the detail response has no full album title). A row without asin + title +
// artist is dropped (the import path filters on both anyway).
function playlistTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  const artists = (node.contributingArtists && Array.isArray(node.contributingArtists.edges))
    ? node.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  if (!artist) return null;
  const album = node.album || {};
  return {
    asin: node.id,
    title: String(node.title).slice(0, 200),
    artist: artist.slice(0, 200),
    album: String(album.shortTitle || album.title || '').slice(0, 200),
    albumAsin: album.id || null,
    duration: typeof node.duration === 'number' ? node.duration : 0
  };
}

// The gql response's data.playlist -> the lookupPlaylist result shape. Picks
// the cover (imageType PRIMARY, else the largest) and a best-effort owner.
// Returns null when data.playlist is null (deleted / private / other region).
function playlistFromGql(data) {
  const playlist = data && data.playlist;
  if (!playlist) return null;
  // Cover: the widest imageType=PRIMARY entry (the 2400×2400 square); when
  // there is no PRIMARY, the widest image overall.
  const images = (Array.isArray(playlist.images) ? playlist.images : []).filter(i => i && i.url);
  const widest = (list) => (list.length ? list.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
  const cover = (widest(images.filter(i => i.imageType === 'PRIMARY')) || widest(images) || {}).url || null;
  const curator = playlist.curator;
  const owner = (curator && typeof curator === 'object' && curator.name) || (typeof curator === 'string' ? curator : null);
  const tracks = (playlist.tracks && Array.isArray(playlist.tracks.edges))
    ? playlist.tracks.edges.map(playlistTrackFromGqlEdge).filter(Boolean)
    : [];
  return {
    id: playlist.id,
    name: playlist.title || 'Amazon Music Playlist',
    owner,
    albumArt: cover,
    trackCount: typeof playlist.trackCount === 'number' ? playlist.trackCount : tracks.length,
    tracks
  };
}

module.exports = {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  measuredStreamKbps,
  mpdAudioRepresentations,
  flacStreamInfoFromInit,
  attachInitStreamInfo,
  pickMpdRepresentation,
  amazonStreamTier,
  amazonStreamQualityRecord,
  installAmazonStreamCapture,
  cdmStatusHealthy,
  pageBlocksPlayback,
  signInLanded,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  isAmazonPlayerChrome,
  pickTrackAsinFromIds,
  parseRowDurationSec,
  amazonSongSearchUrl,
  isAmazonSongResultItem,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  playlistTrackFromGqlEdge,
  playlistFromGql,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS,
  EMPTY_WHILE_PAUSED_POLL_LIMIT,
  QUALITY_PAIR_WINDOW,
  QUALITY_MIN_PAIRS
};
