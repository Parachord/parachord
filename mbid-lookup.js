/**
 * Recording-MBID lookup: the ListenBrainz MBID Mapper with a fallback to the
 * labs `acr-lookup` dataset when the mapper can't be reached.
 *
 * Why the fallback: mapper.listenbrainz.org has been unreachable since
 * 2026-09-21 (it serves a `*.musicbrainz.org` certificate that doesn't cover
 * its own hostname, and answers 502 even when verification is skipped), and
 * it was 502 for two days in June. The labs dataset hoster
 * (labs.api.listenbrainz.org) has a valid certificate and its `acr-lookup`
 * ("artist credit + recording") dataset returns the same identifiers the
 * mapper does: recording, artist and release MBIDs plus canonical names. It
 * is a semi-exact match (case and punctuation are normalized; suffixes like
 * "(Remastered)" are not), so it has no confidence score and is reported with
 * a fixed one.
 *
 * Shared by the renderer (app.js `lookupMbidMapper`, loaded via index.html)
 * and the main process (sync-providers/listenbrainz.js), so the two can't
 * drift. Results are shaped like the mapper's, with `source` added.
 */
(function () {
  'use strict';

  const MAPPER_URL = 'https://mapper.listenbrainz.org/mapping/lookup';
  const ACR_LOOKUP_URL = 'https://labs.api.listenbrainz.org/acr-lookup/json';
  // acr-lookup is exact on normalized strings, so a hit is at least as sure as
  // a mapper result at the canonical-retry floor (0.7) and the 🎯 log line (0.9).
  const ACR_CONFIDENCE = 0.9;
  const UUID_RE = /^[a-f0-9-]{36}$/i;

  function lookupParams(artist, title, album) {
    const params = new URLSearchParams({ artist_credit_name: artist, recording_name: title });
    if (album) params.set('release_name', album);
    return params.toString();
  }
  const mapperLookupUrl = (artist, title, album) => `${MAPPER_URL}?${lookupParams(artist, title, album)}`;
  const acrLookupUrl = (artist, title, album) => `${ACR_LOOKUP_URL}?${lookupParams(artist, title, album)}`;

  function mapperDataToResult(data) {
    if (!data || !UUID_RE.test(data.recording_mbid || '')) return null;
    return {
      recording_mbid: data.recording_mbid,
      artist_credit_mbids: Array.isArray(data.artist_credit_mbids) ? data.artist_credit_mbids : [],
      release_mbid: data.release_mbid || null,
      recording_name: data.recording_name,
      artist_credit_name: data.artist_credit_name,
      release_name: data.release_name,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      source: 'mapper',
    };
  }

  function acrRowToResult(row) {
    if (!row || !UUID_RE.test(row.recording_mbid || '')) return null;
    return {
      recording_mbid: row.recording_mbid,
      artist_credit_mbids: Array.isArray(row.artist_mbids) ? row.artist_mbids : [],
      release_mbid: row.release_mbid || null,
      recording_name: row.recording_name,
      artist_credit_name: row.artist_credit_name,
      release_name: row.release_name,
      confidence: ACR_CONFIDENCE,
      source: 'acr-lookup',
    };
  }

  // Small concurrency gate for the labs host. The mapper answered in ~4ms so
  // batch enrichment could fire every lookup at once; the dataset hoster is a
  // smaller service on infrastructure MetaBrainz has said is under strain.
  // run(fn, { background: true }) queues behind every foreground job: a bulk
  // library pass must never delay the lookup handlePlay is waiting on.
  function createGate({ maxConcurrency, minGapMs }) {
    let inFlight = 0;
    let lastStartAt = 0;
    const pending = [];
    const pendingBackground = [];
    const drain = () => {
      if (inFlight >= maxConcurrency || (pending.length === 0 && pendingBackground.length === 0)) return;
      const wait = Math.max(0, lastStartAt + minGapMs - Date.now());
      if (wait > 0) { setTimeout(drain, wait); return; }
      const job = pending.length > 0 ? pending.shift() : pendingBackground.shift();
      inFlight++;
      lastStartAt = Date.now();
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { inFlight--; drain(); });
    };
    return {
      run: (fn, opts) => new Promise((resolve, reject) => { (opts && opts.background ? pendingBackground : pending).push({ fn, resolve, reject }); drain(); }),
      getQueueLength: () => pending.length + pendingBackground.length,
    };
  }
  const labsGate = createGate({ maxConcurrency: 2, minGapMs: 150 });

  // Returns { status, source, result }:
  //   'hit'         — result is mapper-shaped (see above), source says which service
  //   'miss'        — a service answered and has no match; source says which one.
  //                   Callers should trust an acr-lookup miss less than a mapper
  //                   miss (it's a stricter matcher).
  //   'unreachable' — nothing answered (network/TLS error or non-2xx on both).
  //                   Not a miss: don't cache it or count it against the track.
  //                   `errors` says what each service did, for logging.
  // opts.background: queue the labs call behind user-initiated lookups.
  async function resolveRecordingMbid(artist, title, album, opts) {
    const o = opts || {};
    const fetchImpl = o.fetch || (typeof fetch === 'function' ? fetch : null);
    const errors = {};
    const unreachable = () => ({ status: 'unreachable', source: null, result: null, errors });
    if (!artist || !title || !fetchImpl) return unreachable();

    try {
      const res = await fetchImpl(mapperLookupUrl(artist, title, album));
      if (res && res.ok) {
        const result = mapperDataToResult(await res.json());
        return result ? { status: 'hit', source: 'mapper', result } : { status: 'miss', source: 'mapper', result: null };
      }
      errors.mapper = `HTTP ${res && res.status}`;
    } catch (e) {
      errors.mapper = (e && e.message) || String(e);
    }

    try {
      const res = await labsGate.run(() => fetchImpl(acrLookupUrl(artist, title, album)), { background: !!o.background });
      if (res && res.ok) {
        const rows = await res.json();
        const result = Array.isArray(rows) ? acrRowToResult(rows[0]) : null;
        return result ? { status: 'hit', source: 'acr-lookup', result } : { status: 'miss', source: 'acr-lookup', result: null };
      }
      errors['acr-lookup'] = `HTTP ${res && res.status}`;
    } catch (e) {
      errors['acr-lookup'] = (e && e.message) || String(e);
    }

    return unreachable();
  }

  const api = { MAPPER_URL, ACR_LOOKUP_URL, ACR_CONFIDENCE, mapperLookupUrl, acrLookupUrl, mapperDataToResult, acrRowToResult, resolveRecordingMbid, createGate };

  if (typeof window !== 'undefined') {
    window.resolveRecordingMbid = resolveRecordingMbid;
    window.mbidLookup = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
