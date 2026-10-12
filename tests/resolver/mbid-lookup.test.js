/**
 * Recording-MBID lookup: mapper first, labs acr-lookup when the mapper can't
 * be reached, and "unreachable" (never "miss") when neither answers.
 */

const {
  ACR_CONFIDENCE, mapperLookupUrl, acrLookupUrl, mapperDataToResult, acrRowToResult,
  resolveRecordingMbid, createGate,
} = require('../../mbid-lookup');

const MBID = '70595637-9310-45f2-a266-58f8de4874a7';
const ARTIST_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const RELEASE_MBID = '07aab296-9a40-42a9-8d1f-6b06aa032e8a';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const status = (code) => ({ ok: false, status: code, json: async () => ({}) });
const tlsError = () => { throw new TypeError('Failed to fetch'); };

const mapperHit = { recording_mbid: MBID, artist_credit_mbids: [ARTIST_MBID], release_mbid: RELEASE_MBID, recording_name: 'Creep', artist_credit_name: 'Radiohead', release_name: 'Pablo Honey', confidence: 0.95 };
// Real acr-lookup row shape (labs.api.listenbrainz.org/acr-lookup/json)
const acrRow = { index: 0, artist_credit_arg: 'radiohead', recording_arg: 'creep', artist_credit_name: 'Radiohead', release_name: 'Pablo Honey', recording_name: 'Creep', artist_credit_id: 66, artist_mbids: [ARTIST_MBID], release_mbid: RELEASE_MBID, recording_mbid: MBID };

// Routes by host so a test can script the mapper and labs independently.
function fetchFor({ mapper, labs }) {
  const calls = [];
  const f = jest.fn(async (url) => {
    calls.push(url);
    if (url.startsWith('https://mapper.listenbrainz.org/')) return mapper(url);
    if (url.startsWith('https://labs.api.listenbrainz.org/')) return labs(url);
    throw new Error('unexpected ' + url);
  });
  f.calls = calls;
  return f;
}

describe('URLs', () => {
  test('mapper and labs get the same query, release_name only when given', () => {
    expect(mapperLookupUrl('Radiohead', 'Creep')).toBe('https://mapper.listenbrainz.org/mapping/lookup?artist_credit_name=Radiohead&recording_name=Creep');
    expect(acrLookupUrl('Radiohead', 'Creep', 'Pablo Honey')).toBe('https://labs.api.listenbrainz.org/acr-lookup/json?artist_credit_name=Radiohead&recording_name=Creep&release_name=Pablo+Honey');
  });
});

describe('result shaping', () => {
  test('mapper data keeps its confidence and is tagged mapper', () => {
    expect(mapperDataToResult(mapperHit)).toEqual({ ...mapperHit, source: 'mapper' });
  });

  test('acr row maps artist_mbids → artist_credit_mbids with the fixed confidence', () => {
    expect(acrRowToResult(acrRow)).toEqual({
      recording_mbid: MBID, artist_credit_mbids: [ARTIST_MBID], release_mbid: RELEASE_MBID,
      recording_name: 'Creep', artist_credit_name: 'Radiohead', release_name: 'Pablo Honey',
      confidence: ACR_CONFIDENCE, source: 'acr-lookup',
    });
  });

  test('rejects rows without a valid recording MBID', () => {
    expect(acrRowToResult(undefined)).toBeNull();
    expect(acrRowToResult({ ...acrRow, recording_mbid: 'not-a-uuid' })).toBeNull();
    expect(mapperDataToResult({})).toBeNull();
  });
});

describe('resolveRecordingMbid', () => {
  test('mapper hit: labs is never asked', async () => {
    const fetch = fetchFor({ mapper: () => ok(mapperHit), labs: () => { throw new Error('should not be called'); } });
    const r = await resolveRecordingMbid('Radiohead', 'Creep', 'Pablo Honey', { fetch });
    expect(r.status).toBe('hit');
    expect(r.source).toBe('mapper');
    expect(r.result.recording_mbid).toBe(MBID);
    expect(fetch.calls).toHaveLength(1);
  });

  test('mapper answers with no match: a mapper miss, labs not consulted', async () => {
    const fetch = fetchFor({ mapper: () => ok({}), labs: () => { throw new Error('should not be called'); } });
    const r = await resolveRecordingMbid('Nobody', 'Nothing', null, { fetch });
    expect(r).toEqual({ status: 'miss', source: 'mapper', result: null });
  });

  test('mapper TLS failure (the 2026-09 outage): falls through to acr-lookup', async () => {
    const fetch = fetchFor({ mapper: tlsError, labs: () => ok([acrRow]) });
    const r = await resolveRecordingMbid('radiohead', 'creep', null, { fetch });
    expect(r.status).toBe('hit');
    expect(r.source).toBe('acr-lookup');
    expect(r.result.recording_mbid).toBe(MBID);
    expect(r.result.artist_credit_mbids).toEqual([ARTIST_MBID]);
    expect(r.result.confidence).toBe(ACR_CONFIDENCE);
    expect(fetch.calls.map((u) => new URL(u).host)).toEqual(['mapper.listenbrainz.org', 'labs.api.listenbrainz.org']);
  });

  test('mapper 502: also falls through to acr-lookup', async () => {
    const fetch = fetchFor({ mapper: () => status(502), labs: () => ok([acrRow]) });
    expect((await resolveRecordingMbid('Radiohead', 'Creep', null, { fetch })).source).toBe('acr-lookup');
  });

  test('mapper down, acr-lookup has no row: an acr-lookup miss', async () => {
    const fetch = fetchFor({ mapper: tlsError, labs: () => ok([]) });
    expect(await resolveRecordingMbid('Nobody', 'Nothing', null, { fetch })).toEqual({ status: 'miss', source: 'acr-lookup', result: null });
  });

  test('neither answers: unreachable, not a miss', async () => {
    const fetch = fetchFor({ mapper: tlsError, labs: () => status(503) });
    expect(await resolveRecordingMbid('Radiohead', 'Creep', null, { fetch })).toEqual({
      status: 'unreachable', source: null, result: null,
      errors: { mapper: 'Failed to fetch', 'acr-lookup': 'HTTP 503' },
    });
  });

  test('missing artist or title: unreachable without any request', async () => {
    const fetch = fetchFor({ mapper: () => ok(mapperHit), labs: () => ok([acrRow]) });
    expect((await resolveRecordingMbid('', 'Creep', null, { fetch })).status).toBe('unreachable');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('createGate', () => {
  test('caps concurrency', async () => {
    const gate = createGate({ maxConcurrency: 2, minGapMs: 0 });
    let running = 0, peak = 0;
    const job = () => new Promise((resolve) => {
      running++; peak = Math.max(peak, running);
      setTimeout(() => { running--; resolve(); }, 5);
    });
    await Promise.all([1, 2, 3, 4, 5].map(() => gate.run(job)));
    expect(peak).toBe(2);
  });

  test('propagates results and rejections', async () => {
    const gate = createGate({ maxConcurrency: 1, minGapMs: 0 });
    await expect(gate.run(async () => 42)).resolves.toBe(42);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
