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
const QUALITY_SHIFT_RATIO = 0.35;  // recent median this far from the track median = a real quality change
const QUALITY_TRACK_RATES_MAX = 2000; // ~66 min of 2s pairs; older rates drop first

// The kbps of one pair of consecutive samples, or null when the pair is not
// a steady measurement (seek, pause, dropped poll, stalled or missing counter,
// absurd rate).
function streamPairKbps(prev, next) {
  if (!prev || !next) return null;
  const wallMs = (next.wallMs || 0) - (prev.wallMs || 0);
  const posMs = (next.positionMs || 0) - (prev.positionMs || 0);
  const bytes = (next.bytes || 0) - (prev.bytes || 0);
  if (wallMs < QUALITY_MIN_PAIR_MS || wallMs > QUALITY_MAX_PAIR_MS) return null;
  if (Math.abs(posMs - wallMs) > QUALITY_MAX_DRIFT_MS) return null;
  if (bytes <= 0) return null; // nothing decoded in the window (counter missing / stall)
  const kbps = Math.round((bytes * 8) / posMs);
  if (kbps < QUALITY_MIN_KBPS || kbps > QUALITY_MAX_KBPS) return null;
  return kbps;
}

function medianKbps(rates) {
  const sorted = rates.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// samples: [{ wallMs, positionMs, bytes }] as recorded by the poller (bytes
// may be null on reads where the element exposed no counter — those just never
// form pairs). Returns the median of the last QUALITY_PAIR_WINDOW pair rates
// (~16s at the 2s cadence), or null while too few steady pairs exist.
function measuredStreamKbps(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const rates = [];
  for (let i = 1; i < list.length; i++) {
    const kbps = streamPairKbps(list[i - 1], list[i]);
    if (kbps !== null) rates.push(kbps);
  }
  if (rates.length < QUALITY_MIN_PAIRS) return null;
  return medianKbps(rates.slice(-QUALITY_PAIR_WINDOW));
}

// The bitrate the poller reports: the median of every steady pair rate of the
// track, so a VBR stream (every Amazon tier above 160 kbps) settles on its
// average instead of following a 16s window (review on #1100). A median, not
// a running mean, because the first pairs read 3-5x high while the decoder's
// buffers fill, and a mean carries that for minutes. The recent window still
// matters for one thing: when its median is more than QUALITY_SHIFT_RATIO
// away from the track's, the stream changed tier (Amazon's auto adjust), and
// the track's rates restart from the recent window so the report follows it.
// One meter per track (the poller makes a new one in start()).
function createStreamBitrateMeter() {
  let last = null;
  let trackRates = [];
  const recent = [];
  return {
    addSample(sample) {
      const kbps = streamPairKbps(last, sample);
      last = sample;
      if (kbps === null) return;
      trackRates.push(kbps);
      if (trackRates.length > QUALITY_TRACK_RATES_MAX) trackRates.shift();
      recent.push(kbps);
      if (recent.length > QUALITY_PAIR_WINDOW) recent.shift();
    },
    kbps() {
      if (trackRates.length < QUALITY_MIN_PAIRS) return null;
      const track = medianKbps(trackRates);
      if (recent.length >= QUALITY_MIN_PAIRS) {
        const now = medianKbps(recent);
        if (Math.abs(now - track) / track > QUALITY_SHIFT_RATIO) {
          trackRates = recent.slice();
          return now;
        }
      }
      return track;
    },
  };
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
// (4-byte block header + 34-byte STREAMINFO). A bare 34-byte read after the
// fourcc is not accepted: those checks only bound sample rate and bit depth,
// so random bytes after a coincidental dfla/dfLa parsed as FLAC.
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

// Circuit breaker for search's structural failures. A hornet rename of the
// search operation makes every search wait the full capture window and then
// throw not-ready — serially on the search chain, a 100-track resolution run
// burns ~25 minutes there and starves playlist imports too. After `threshold`
// consecutive structural failures the breaker opens for `cooldownMs`; while
// open, searchTracks fails fast instead of burning the window. When the
// cooldown elapses the next search is a probe (one window); a failure re-opens
// the breaker, any success closes it. Pure with an injected now() — the poller
// pattern.
function createSearchBreaker({ threshold = 3, cooldownMs = 10 * 60 * 1000, now = Date.now } = {}) {
  let failures = 0;
  let openUntil = 0;
  const open = () => failures >= threshold && now() < openUntil;
  return {
    allows: () => !open(),
    isProbe: () => failures >= threshold && now() >= openUntil,
    recordFailure() {
      failures += 1;
      if (failures >= threshold) openUntil = now() + cooldownMs;
    },
    recordSuccess() {
      failures = 0;
      openUntil = 0;
    },
    state: () => ({ failures, openUntil, open: open() })
  };
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

// A settings read must not persist. The live store can exist before abrEnabled
// is materialized; !!undefined is false, and writePersistedQuality treats
// false as a real patch. Opening the quality panel used to write that into
// the entry hornet rehydrates at boot, turning Auto-adjust off.
// persist is null on a read, and when a write has no concrete fields yet.
function amazonQualityFromStore(storeSettings, apply) {
  if (!storeSettings || typeof storeSettings !== 'object') return null;
  if (apply) {
    if (apply.streamingQuality) storeSettings.streamingQuality = apply.streamingQuality;
    if (apply.abrEnabled != null) storeSettings.abrEnabled = !!apply.abrEnabled;
  }
  const report = {
    streamingQuality: storeSettings.streamingQuality || null,
    abrEnabled: storeSettings.abrEnabled != null ? !!storeSettings.abrEnabled : true
  };
  if (!apply) return { report, persist: null };
  const persist = {};
  if (storeSettings.streamingQuality != null) persist.streamingQuality = storeSettings.streamingQuality;
  if (storeSettings.abrEnabled != null) persist.abrEnabled = !!storeSettings.abrEnabled;
  if (persist.streamingQuality == null && persist.abrEnabled == null) return { report, persist: null };
  return { report, persist };
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

// A loose "Stations Warning" search misses the song, so both terms are
// quoted — but quoting alone imposes phrase ORDER, and Amazon's matching
// is order-sensitive in both directions (live-verified 2026-10 through the
// app): Warning's "Stations" only surfaces as '"Stations" "Warning"' while
// ХЛЕБ's "Яйца" only surfaces as '"ХЛЕБ" "Яйца"'. So the query ORs the two
// orders in one page load: '"title" "artist" OR "artist" "title"'. Amazon
// unions the clauses (the literal keyword OR adds a few noise rows — tracks
// whose title contains "or" — which the resolver's artist+title filter and
// the confidence gate drop).
// Returns { url, searchText } — the search runs over gql (the page's own
// SpecSearchSeeMorePage request, captured and replayed), and searchText is the
// exact string the page puts in variables.searchText, so the caller can find
// its own request among everything the page fires. The songs tab is always
// used: that is the page which fires the track search. Returns null when
// there is nothing to search.
function amazonSongSearchUrl({ title, artist, query } = {}) {
  const quote = (value) => '"' + String(value || '').replace(/"/g, '').trim() + '"';
  let q = '';
  if ((title && String(title).trim()) || (artist && String(artist).trim())) {
    const titlePart = title && String(title).trim() ? quote(title) : '';
    const artistPart = artist && String(artist).trim() ? quote(artist) : '';
    q = titlePart && artistPart
      ? titlePart + ' ' + artistPart + ' OR ' + artistPart + ' ' + titlePart
      : titlePart || artistPart;
  } else {
    q = String(query || '').trim();
  }
  if (!q) return null;
  return { url: 'https://music.amazon.com/search/' + encodeURIComponent(q) + '/songs', searchText: q };
}

// A playlist page lives at /playlists/<id> (shared/brand playlists),
// /my/playlists/<id> (the user's own) or /user-playlists/<id> (the share-link
// shape for user-created playlists). The id is a long token — PP… (brand), a
// bare hex uuid, or a dashed uuid (live-observed 2026-10) — not the 10-char
// ASIN a track uses (brand playlists use those too). The id class must accept
// dashes: a dashed-uuid id truncated at its first dash never matches the
// page's own playlistDetail request (variables.id), and the import times out
// into "Playlist not found".
function amazonPlaylistIdFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/(?:my\/)?(?:user-)?playlists\/([A-Za-z0-9-]+)/i);
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

// The search request the page fired for OUR query — the same
// capture-and-replay pattern as playlistDetail. Matched on
// variables.searchText (case-insensitive equality), NOT the operationName:
// the songs tab fires SpecSearchSeeMorePage today, but matching the text
// survives an operation rename, and the text is unique among the page's
// requests (only the spec search carries it).
//
// Only the TRACK spec is accepted by default: an album/artist/playlist spec
// for the same text is a different entity whose ASIN must never reach
// playback — an album-shaped edge maps to { asin: <albumAsin>, title, artist }
// and a self-titled release passes the confidence gate, which is exactly the
// album-ASIN failure the DOM-era exclusion dance existed to prevent. A body
// with no specType at all is accepted (older deploys). Pass { spec: 'album' }
// from album search to accept the album spec instead — the album parser
// rejects non-Album nodes, so a track-only response is a miss, never a
// misfiled entity. With { anySpec: true } the first searchText match of ANY
// spec is returned — used only to detect "the page searched our text, but
// the wanted spec never came" (the grace decision in searchTracks), never
// for replay.
function amazonSpecSearchRequest(bodies, searchText, { anySpec = false, spec = 'track' } = {}) {
  const wanted = String(searchText || '').trim().toLowerCase();
  if (!wanted) return null;
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      const vars = req && req.variables;
      if (!vars || typeof vars.searchText !== 'string') continue;
      if (String(vars.searchText).trim().toLowerCase() !== wanted) continue;
      if (anySpec || vars.specType == null || vars.specType === spec) return req;
    }
  }
  return null;
}

// The albums-tab search page — /search/<q>/albums fires the album-spec
// SpecSearchSeeMorePage (specType: 'album', same operation and query as the
// songs tab's track spec — live-verified 2026-10). The query string is built
// exactly like the songs one: quoted terms OR'd in both orders, since
// Amazon's matching is order-sensitive in both directions.
function amazonAlbumSearchUrl(input) {
  // Same input contract as the web player: a free-text string, or { title,
  // artist, query } (the album pages send { artist, title }).
  const opts = typeof input === 'string' ? { query: input } : input;
  const spec = amazonSongSearchUrl(opts || {});
  if (!spec) return null;
  return { url: spec.url.replace(/\/songs$/, '/albums'), searchText: spec.searchText };
}

// The album page lives at /albums/<ASIN> — a 10-char uppercase ASIN, unlike
// the long token playlist ids use. The gql search response carries node.url
// with a ?ref= tracker; both that and the bare canonical form yield the ASIN.
function amazonAlbumAsinFromUrl(url) {
  const m = String(url || '').match(/music\.amazon\.com\/albums\/([A-Za-z0-9]{10})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// The album-detail request the page fired for OUR album — the same
// capture-and-replay pattern as playlistDetail. The album page fires it as
// AlbumDetailPage with variables.id = the ASIN (live-captured 2026-10). Only
// an album-named read operation matches by default: the page fires other read
// queries in parallel, and an unrelated one that happens to carry the ASIN in
// its variables must not win the replay by arriving first. With
// { anyName: true } any read request whose variables.id is our ASIN is a
// candidate (an album-named one still preferred) — the rename hedge the
// caller accepts only after the album-named op never came; a wrong-envelope
// replay from it surfaces as lookup-failed, loud, instead of a silent miss.
// Write-shaped names (a replay would repeat the action on the user's
// account) never are candidates.
function amazonAlbumDetailRequest(bodies, asin, { anyName = false } = {}) {
  const wanted = String(asin || '').toUpperCase();
  if (!wanted || wanted === 'UNDEFINED' || wanted === 'NULL') return null;
  let candidate = null;
  for (const raw of (Array.isArray(bodies) ? bodies : [])) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }
    const batch = Array.isArray(parsed) ? parsed : [parsed];
    for (const req of batch) {
      const opName = String((req && req.operationName) || '');
      if (GQL_WRITE_OP.test(opName) || GQL_MUTATION_NAME.test(opName)) continue;
      if (/^\s*mutation\b/.test(String((req && req.query) || ''))) continue;
      const vars = req && req.variables;
      if (!vars || typeof vars !== 'object') continue;
      if (String(vars.id || '').toUpperCase() !== wanted) continue;
      if (/album/i.test(opName)) return req;
      if (anyName && !candidate) candidate = req;
    }
  }
  return candidate;
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

// The widest imageType=PRIMARY image, else the widest image overall. The
// playlist cover and the per-track art use the same pick.
function gqlPrimaryImageUrl(images) {
  const list = (Array.isArray(images) ? images : []).filter(i => i && i.url);
  const widest = (l) => (l.length ? l.reduce((a, b) => ((b.width || 0) >= (a.width || 0) ? b : a)) : null);
  return (widest(list.filter(i => i.imageType === 'PRIMARY')) || widest(list) || {}).url || null;
}

// One tracks.edges[] entry -> the lookupPlaylist track shape. Artist is the
// joined contributing artists (PRIMARY first); album is the album shortTitle
// (the detail response has no full album title). A row without asin + title +
// artist is dropped (the import path filters on both anyway). The same mapper
// serves the search response — its edges carry the same Track entity
// (live-verified 2026-10: id/title/contributingArtists/album/duration/images
// Amazon renders the explicit tag as a marker INSIDE the title text
// ("Kunnioita [Explicit]") — the gql Track node carries no explicit field.
// Left in, the tag pollutes every downstream consumer that compares this
// title against another provider's spelling (cross-resolver enrichment, sync
// mirrors, and scrobbles — "Kunnioita [Explicit]" is a different Last.fm
// track). Strip a TRAILING bracketed/parenthesized "explicit" marker (the
// only shape Amazon uses) and report it, so the edge mapper can set the
// explicit flag the payload itself lacks. A bare word ("Sexually Explicit")
// is the track's real title and is left alone.
function stripAmazonTitleMarker(title) {
  const raw = String(title || '');
  const m = raw.match(/^(.*?)\s*[[(]\s*explicit\s*[\])]\s*$/i);
  if (!m) return { title: raw.trim(), explicit: false };
  return { title: m[1].trim(), explicit: true };
}

// are identical shapes), and the search flow additionally uses the art.
// Only Track entities import: the search response asks for __typename, and an
// album/artist-spec edge (an Album node) must never become a track — an album
// ASIN in the track slot passes the confidence gate on self-titled releases
// and playback loads /tracks/<albumAsin>. Absent __typename (the playlist
// detail response does not request it) is allowed.
function playlistTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  if (node.__typename && node.__typename !== 'Track') return null;
  const artists = (node.contributingArtists && Array.isArray(node.contributingArtists.edges))
    ? node.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title);
  if (!cleaned.title) return null;
  const album = node.album || {};
  return {
    asin: node.id,
    title: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    album: String(album.shortTitle || album.title || '').slice(0, 200),
    albumAsin: album.id || null,
    albumArt: gqlPrimaryImageUrl(node.images) || null,
    duration: typeof node.duration === 'number' ? node.duration : 0,
    explicit: cleaned.explicit
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
  const cover = gqlPrimaryImageUrl(playlist.images);
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

// --- Playlist pagination (a >page-size playlist arrives in pages) ---
// The server clamps the page size (a 977-track playlist answered 100 rows
// however high firstLimit was raised), so the import has to follow the
// playlist's own pagination. Everything below is learned from the page or the
// response — no param name or cursor format is hardcoded against hornet.

// The connection's pageInfo, when the response carries one. hasNextPage null =
// absent; endCursor null = absent. Returns null when there is no pageInfo at
// all (the caller falls back to scroll-driven pagination).
function playlistPageInfoFromGql(data) {
  const tracks = data && data.playlist && data.playlist.tracks;
  const pageInfo = tracks && tracks.pageInfo;
  if (!pageInfo || typeof pageInfo !== 'object') return null;
  const endCursor = pageInfo.endCursor == null ? null : String(pageInfo.endCursor);
  const hasNextPage = typeof pageInfo.hasNextPage === 'boolean' ? pageInfo.hasNextPage : null;
  // token is the page's OWN continuation state (a composite base64 blob) —
  // the value the next request passes as afterCursor. Live-verified 2026-10:
  // the token advances the pages; the Relay-style endCursor is ignored by the
  // server (page 1 repeats) and the dependent blob alone errors.
  const token = typeof pageInfo.token === 'string' && pageInfo.token ? pageInfo.token : null;
  return { hasNextPage, endCursor, token };
}

// The response's track edges. The playlistDetail envelope is
// data.playlist.tracks.edges; a continuation operation may answer with a
// different envelope, so fall back to a bounded scan for any edges[] whose
// nodes look like playlist rows (id + title).
function playlistEdgesFromGql(data) {
  const tracks = data && data.playlist && data.playlist.tracks;
  if (tracks && Array.isArray(tracks.edges)) return tracks.edges;
  const looksLikeRow = (edges) =>
    Array.isArray(edges) && edges.some(e => e && e.node && e.node.id && e.node.title);
  const scan = (value, depth) => {
    if (depth > 4 || !value || typeof value !== 'object') return null;
    if (looksLikeRow(value.edges)) return value.edges;
    for (const key of Object.keys(value)) {
      const found = scan(value[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return scan(data, 0);
}

// The SpecSearchSeeMorePage response -> the searchTracks result. The
// response answers with data.specificationSearch.result[], the spec result
// carrying edges[].node = the same Track entity the playlist detail returns
// (shared edge mapper above). A miss is a present envelope with empty edges;
// an absent envelope (hornet renamed the field) is a structural failure — the
// caller must throw not-ready, not cache a 30-day noMatch. Returns
// { tracks, envelope }.
function searchTracksFromGql(data) {
  const search = data && data.specificationSearch;
  if (!search || typeof search !== 'object') return { tracks: [], envelope: false };
  const results = Array.isArray(search.result) ? search.result : [];
  let spec = null;
  for (const r of results) {
    if (r && Array.isArray(r.edges) && r.edges.length) { spec = r; break; }
  }
  if (!spec) {
    for (const r of results) {
      if (r && Array.isArray(r.edges)) { spec = r; break; }
    }
  }
  const tracks = ((spec && spec.edges) || [])
    .map(playlistTrackFromGqlEdge)
    .filter(Boolean);
  return { tracks, envelope: true };
}

// --- Album search / lookup (capabilities.albumSearch in the plugin) -------
// The album-spec SpecSearchSeeMorePage response and the AlbumDetailPage
// response (both shapes live-verified 2026-10 via the page's own requests,
// replayed verbatim like the track search and playlistDetail).
//
// Search: data.specificationSearch.result[] carries edges[] whose node is an
// ALBUM entity this time: id (ASIN), title (may end in the bracketed explicit
// marker, like track titles), shortTitle, contributingArtists, images and url
// — the Album node has no releaseDate/trackCount in the search spec, so those
// stay null in the mapped result (the plugin contract allows it). Only Album
// nodes map: a Track edge in the album slot is the same ASIN-in-the-wrong-
// slot failure the track parser guards against, in reverse.
function albumFromGqlSearchNode(node) {
  if (!node || node.__typename !== 'Album' || !node.id) return null;
  const artists = (node.contributingArtists && Array.isArray(node.contributingArtists.edges))
    ? node.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title || node.shortTitle || '');
  if (!cleaned.title) return null;
  return {
    asin: node.id,
    name: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    albumArt: gqlPrimaryImageUrl(node.images) || null,
    // node.url exists but carries a ?ref= tracker; the canonical album URL is
    // the form lookupAlbum parses anyway, so mint it from the ASIN.
    url: 'https://music.amazon.com/albums/' + node.id,
    explicit: cleaned.explicit || !!(node.parentalSettings && node.parentalSettings.hasExplicitLanguage)
  };
}

// The album-spec response -> the searchAlbums bridge shape. Same envelope
// semantics as searchTracksFromGql: a miss is a present envelope with no
// usable edges; an absent envelope (hornet renamed the field) is structural.
function searchAlbumsFromGql(data) {
  const search = data && data.specificationSearch;
  if (!search || typeof search !== 'object') return { albums: [], envelope: false };
  const results = Array.isArray(search.result) ? search.result : [];
  let spec = null;
  for (const r of results) {
    if (r && Array.isArray(r.edges) && r.edges.length) { spec = r; break; }
  }
  if (!spec) {
    for (const r of results) {
      if (r && Array.isArray(r.edges)) { spec = r; break; }
    }
  }
  const albums = ((spec && spec.edges) || [])
    .map(e => albumFromGqlSearchNode(e && e.node))
    .filter(Boolean);
  return { albums, envelope: true };
}

// One AlbumDetailPage tracksConnection.edges[] entry -> the album track
// shape. Like the playlist/search row (shared contributingArtists and
// title-marker handling) plus trackNumber, and the explicit flag from
// parentalSettings when the title carries no marker (the detail response
// carries both — "Dumpweed [Explicit]" with hasExplicitLanguage true).
// Per-track artists matter on compilations: a Various Artists row keeps its
// own artists, not the album's.
function albumTrackFromGqlEdge(edge) {
  const node = edge && edge.node;
  if (!node || !node.id || !node.title) return null;
  if (node.__typename && node.__typename !== 'Track') return null;
  const artists = (node.contributingArtists && Array.isArray(node.contributingArtists.edges))
    ? node.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  if (!artist) return null;
  const cleaned = stripAmazonTitleMarker(node.title);
  if (!cleaned.title) return null;
  return {
    asin: node.id,
    title: cleaned.title.slice(0, 200),
    artist: artist.slice(0, 200),
    duration: typeof node.duration === 'number' ? node.duration : 0,
    trackNumber: typeof node.trackNumber === 'number' ? node.trackNumber : null,
    explicit: cleaned.explicit || !!(node.parentalSettings && node.parentalSettings.hasExplicitLanguage)
  };
}

// The album detail response numbers tracks per disc (1..n, 1..m — verified
// on 2-disc, 3-disc and 100-track sets) but carries no discNumber field
// anywhere: a trackNumber that does not advance past the previous one starts
// a new disc. Rows without a trackNumber keep discNumber null (the plugin
// contract has it "when known").
function assignDiscNumbers(tracks) {
  let disc = 1;
  let prev = 0;
  for (const t of tracks) {
    if (typeof t.trackNumber === 'number') {
      if (t.trackNumber <= prev) disc += 1;
      prev = t.trackNumber;
      t.discNumber = disc;
    } else {
      t.discNumber = null;
    }
  }
  return tracks;
}

// The AlbumDetailPage response's data.album -> the lookupAlbum bridge shape.
// The tracksConnection has no pageInfo at all (a 100-track album answers all
// 100 edges in one response — live-verified), so unlike playlistDetail there
// is no continuation to follow; trackCount above the edge count is logged by
// the caller as a truncation, the way a short playlist page is. Returns
// { album, envelope }: data.album null is a legitimate not-found (deleted /
// other region), a data object with no 'album' field at all is a hornet
// rename (structural — the caller throws instead of reporting a miss).
function albumDetailFromGql(data) {
  if (!data || typeof data !== 'object' || !('album' in data)) {
    return { album: null, envelope: false };
  }
  const album = data.album;
  if (!album || typeof album !== 'object') return { album: null, envelope: true };
  const artists = (album.contributingArtists && Array.isArray(album.contributingArtists.edges))
    ? album.contributingArtists.edges : [];
  const primary = artists.filter(a => a && a.node && a.node.name && a.role === 'PRIMARY');
  const all = artists.filter(a => a && a.node && a.node.name);
  const chosen = primary.length ? primary : all;
  const artist = chosen.map(a => a.node.name).join(', ');
  const cleaned = stripAmazonTitleMarker(album.title || album.shortTitle || '');
  const edges = (album.tracksConnection && Array.isArray(album.tracksConnection.edges))
    ? album.tracksConnection.edges : [];
  const tracks = assignDiscNumbers(edges.map(albumTrackFromGqlEdge).filter(Boolean));
  return {
    album: {
      asin: album.id || null,
      // The full title (editions distinguish releases), not shortTitle.
      name: (cleaned.title || album.shortTitle || '').slice(0, 200),
      artist: artist.slice(0, 200) || null,
      albumArt: gqlPrimaryImageUrl(album.images) || null,
      releaseDate: typeof album.releaseDate === 'string' ? album.releaseDate : null,
      trackCount: typeof album.trackCount === 'number' ? album.trackCount : tracks.length,
      url: album.id ? 'https://music.amazon.com/albums/' + album.id : null,
      explicit: cleaned.explicit || !!(album.parentalSettings && album.parentalSettings.hasExplicitLanguage),
      tracks
    },
    envelope: true
  };
}

// Follow a playlist's own pagination to the end of the list. The gql server
// serves one page per request however high firstLimit is raised, and the ONLY
// continuation it accepts is the response's pageInfo.token passed as the
// afterCursor variable (live-verified 2026-10 — the Relay-style endCursor is
// a decoy the server answers with page 1 for, other variable names are
// dropped, the dependent blob alone errors "Invalid sequence token"). Each
// response's own token drives the next page.
//
// Pure except the injected fetchPage (one gql page by token: { error } or
// { data }) and now() (the time cap) — the same pattern as the Amazon poller,
// so every stop condition is unit-testable.
//
// Progress is judged on RAW edges, never mapped tracks (review feedback on
// #1072): a page that is entirely delisted rows (node:null) maps to zero
// tracks but still advances — later pages can exist after a label pulls its
// catalog — and a duplicate track that happens to be first on two consecutive
// pages is not a repeated window. The per-edge cursor (position-encoded:
// "128:dfeab136-…128") distinguishes a genuine advance from the same window
// served again.
//
// Returns { playlist, pages, stop }:
//   'complete'    — every row merged (tracks >= trackCount)
//   'exhausted'   — the server is out of pages (no token / hasNextPage false)
//   'page-error'  — fetchPage answered an error (a later page may exist)
//   'empty-page'  — a page with zero raw edges
//   'no-advance'  — a page starting at the same cursor as the previous one
//   'page-limit'  / 'time-limit' — the caps
//   'no-playlist' — the first page has no playlist (deleted/private/region)
async function paginatePlaylistTracks({ firstPageData, fetchPage, maxPages = 40, maxMs = 120000, now = Date.now, log = () => {} }) {
  const playlist = playlistFromGql(firstPageData);
  if (!playlist) return { playlist: null, pages: 0, stop: 'no-playlist' };
  const firstEdges = playlistEdgesFromGql(firstPageData) || [];
  let lastFirstCursor = firstEdges.length && firstEdges[0] && firstEdges[0].cursor != null
    ? String(firstEdges[0].cursor) : null;
  let pageInfo = playlistPageInfoFromGql(firstPageData);
  const startedAt = now();
  let pages = 0;
  let stop = null;
  while (!stop) {
    if (playlist.tracks.length >= playlist.trackCount) { stop = 'complete'; break; }
    if (!pageInfo || !pageInfo.token || pageInfo.hasNextPage === false) { stop = 'exhausted'; break; }
    if (pages >= maxPages) { stop = 'page-limit'; break; }
    if (now() - startedAt >= maxMs) { stop = 'time-limit'; break; }
    pages += 1;
    const page = await fetchPage(pageInfo.token);
    if (!page || page.error) { stop = 'page-error'; break; }
    const data = page.data;
    const edges = (data && playlistEdgesFromGql(data)) || [];
    if (!edges.length) { stop = 'empty-page'; break; }
    const firstCursor = edges[0] && edges[0].cursor != null ? String(edges[0].cursor) : null;
    if (firstCursor != null && firstCursor === lastFirstCursor) { stop = 'no-advance'; break; }
    lastFirstCursor = firstCursor;
    let mappedAdded = 0;
    for (const edge of edges) {
      const track = playlistTrackFromGqlEdge(edge);
      if (track) {
        playlist.tracks.push(track);
        mappedAdded++;
      }
    }
    const info = data ? playlistPageInfoFromGql(data) : null;
    if (info) pageInfo = info;
    const respCount = data && data.playlist && data.playlist.trackCount;
    if (typeof respCount === 'number' && respCount > playlist.trackCount) playlist.trackCount = respCount;
    log(`page ${pages}: +${edges.length} rows (+${mappedAdded} tracks, ${playlist.tracks.length}/${playlist.trackCount})`);
  }
  return { playlist, pages, stop };
}

// A halt that started for play N must not pause play N+1. The page token is
// stamped after the track document loads. A generation-scoped pause no-ops
// unless that token matches — including when the token is missing, so a halt
// that races the stamp cannot pause a page it does not own. User pause passes
// no generation and always pauses the current element.
function amazonMediaPauseExpr(expectedGeneration) {
  if (!Number.isFinite(expectedGeneration)) return 'm.pause();';
  const gen = expectedGeneration | 0;
  return `if (window.__parachordPlayGen !== ${gen}) return { ok: false, superseded: true }; m.pause();`;
}

function isAmazonMusicPage(url) {
  try {
    return new URL(url).origin === 'https://music.amazon.com';
  } catch {
    return false;
  }
}

// ── Diagnostic: gql shapes from a live page ─────────────────────────────────
// Album search and album lookup for the Amazon plugin need the request and
// response shapes Amazon's own album and search pages use, and only a live
// signed-in session shows them (every Amazon flow replays the page's own
// request; see docs/architecture/amazon-music.md). amazonWebPlayer's
// debugCaptureGql records them; these pure helpers decide what it replays and
// what may be written to disk.

// What a page is about: an album page's ASIN, or a search page's text and tab
// (/search/<text>/albums, /search/<text>/songs, ...). null for anything else.
function gqlCaptureSubject(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.origin !== 'https://music.amazon.com') return null;
  const album = /^\/albums\/([A-Z0-9]{10})(?:\/|$)/i.exec(u.pathname);
  if (album) return { kind: 'album', asin: album[1].toUpperCase() };
  const search = /^\/search\/([^/]+)(?:\/([a-z]+))?\/?$/i.exec(u.pathname);
  if (search) {
    let text;
    try { text = decodeURIComponent(search[1]); } catch { text = search[1]; }
    return { kind: 'search', searchText: text, tab: search[2] ? search[2].toLowerCase() : null };
  }
  return null;
}

// The requests in one captured body: a single request or a batch.
function gqlRequestsIn(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(r => r && typeof r === 'object');
}

// Operation names that change account state or report activity. Never
// replayed, even when their variables name the album: a replay would repeat
// the action ("add to library", "record a view") on the user's account.
const GQL_WRITE_OP = /^(?:add|remove|delete|update|set|put|create|follow|unfollow|like|unlike|save|record|log|report|send|post|mark)[A-Z_]|^track[A-Z]/;
const GQL_MUTATION_NAME = /mutation/i;

// Whether a captured request is the page's own read query for what it shows:
// its variables name the album ASIN, or carry the search text. Only these are
// replayed (to read their response shape); everything else is listed by name.
function gqlRequestIsAboutSubject(req, subject) {
  if (!req || !subject || !req.variables || typeof req.variables !== 'object') return false;
  if (/^\s*mutation\b/.test(String(req.query || ''))) return false;
  const opName = String(req.operationName || '');
  if (GQL_WRITE_OP.test(opName) || GQL_MUTATION_NAME.test(opName)) return false;
  if (subject.kind === 'album') {
    return JSON.stringify(req.variables).toUpperCase().includes(subject.asin);
  }
  if (subject.kind === 'search') {
    const text = req.variables.searchText;
    return typeof text === 'string' && text.toLowerCase() === String(subject.searchText).toLowerCase();
  }
  return false;
}

// Keys whose values could identify or authenticate the user.
const GQL_SECRET_KEY = /token|cookie|session|auth|csrf|secret|password|credential|signature|customer|device|email/i;

// A copy of a gql value that is safe to write to disk and share: secret-
// looking keys redacted, query strings cut from URLs (signed CDN URLs carry
// credentials), long strings and long arrays trimmed. The shape survives;
// that is what a parser needs.
function redactGqlSample(value, opts = {}, depth = 0) {
  const maxArray = opts.maxArray || 3;
  const maxString = opts.maxString || 300;
  if (depth > 40) return '[too deep]';
  if (Array.isArray(value)) {
    const out = value.slice(0, maxArray).map(v => redactGqlSample(v, opts, depth + 1));
    if (value.length > maxArray) out.push(`[${value.length - maxArray} more]`);
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = GQL_SECRET_KEY.test(k) ? '[redacted]' : redactGqlSample(v, opts, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    let s = value;
    if (/^https?:\/\//i.test(s) && s.includes('?')) s = `${s.slice(0, s.indexOf('?'))}?[query removed]`;
    return s.length > maxString ? `${s.slice(0, maxString)}…` : s;
  }
  return value;
}

// One captured request as written to the capture file: never header values
// (they carry the session), only their names.
function summarizeGqlRequest(entry, req) {
  let endpoint = null;
  try {
    const u = new URL(entry && entry.url);
    endpoint = u.origin + u.pathname;
  } catch { /* leave null */ }
  return {
    operationName: (req && req.operationName) || null,
    endpoint,
    persistedQuery: !!(req && req.extensions && req.extensions.persistedQuery),
    hasQueryText: !!(req && req.query),
    variables: redactGqlSample(req && req.variables, { maxArray: 10 }),
    headerNames: Object.keys((entry && entry.headers) || {}).sort()
  };
}

function amazonPlayGenerationStamp(generation) {
  return `window.__parachordPlayGen = ${generation | 0};`;
}

module.exports = {
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest,
  reportedPlaybackAsin,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  isAmazonMusicPage,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  measuredStreamKbps,
  createStreamBitrateMeter,
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
  amazonQualityFromStore,
  amazonSongSearchUrl,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonSpecSearchRequest,
  amazonAlbumSearchUrl,
  amazonAlbumAsinFromUrl,
  amazonAlbumDetailRequest,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  searchTracksFromGql,
  albumFromGqlSearchNode,
  searchAlbumsFromGql,
  albumTrackFromGqlEdge,
  assignDiscNumbers,
  albumDetailFromGql,
  createSearchBreaker,
  playlistTrackFromGqlEdge,
  stripAmazonTitleMarker,
  playlistFromGql,
  playlistPageInfoFromGql,
  paginatePlaylistTracks,
  playlistEdgesFromGql,
  NEAR_END_MS,
  WRAP_POSITION_MS,
  FAST_POLL_REMAINING_MS,
  EMPTY_WHILE_PAUSED_POLL_LIMIT,
  QUALITY_PAIR_WINDOW,
  QUALITY_SHIFT_RATIO,
  QUALITY_MIN_PAIRS
};
