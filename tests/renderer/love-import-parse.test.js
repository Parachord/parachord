/**
 * Loved-tracks IMPORT (parachord#1071): parsing each service's loved-tracks
 * pages. Fixtures are the real API shapes, anonymized. A Last.fm love's
 * `mbid` is deliberately dropped (often stale — plan
 * docs/plans/2026-11-06-import-loved-tracks.md, decision 4); a ListenBrainz
 * feedback row with an MBID but no metadata is kept for the MusicBrainz name
 * lookup; an MSID-only row whose metadata ListenBrainz filled from
 * MessyBrainz arrives with names and matches by name.
 */

const {
  parseLastfmLovedPage,
  parseListenbrainzFeedbackPage,
} = require('../../src/renderer/lib/love-import');

const lastfmPage = require('../fixtures/lastfm-lovedtracks.json');
const lbFeedback = require('../fixtures/listenbrainz-get-feedback.json');

describe('parseLastfmLovedPage', () => {
  test('maps names and the loved-at date (uts string seconds), and DROPS the mbid', () => {
    const { loves, skipped, total, totalPages, returned } = parseLastfmLovedPage(lastfmPage);
    expect(total).toBe(842);
    expect(totalPages).toBe(281);
    expect(returned).toBe(4);
    expect(skipped).toBe(0);
    expect(loves[0]).toEqual({
      service: 'lastfm',
      artist: 'Radiohead',
      title: 'Creep',
      album: '',
      mbid: null,
      lovedAt: 1735689600,
    });
  });

  test('keeps non-Latin names, and a love with no date gets lovedAt null', () => {
    const { loves } = parseLastfmLovedPage(lastfmPage);
    expect(loves[1].artist).toBe('Tokyo Jihen');
    expect(loves[1].title).toBe('修羅場');
    expect(loves[2].lovedAt).toBeNull();
  });

  test('an artist written as #text (the older serialization) maps the same way', () => {
    const { loves } = parseLastfmLovedPage(lastfmPage);
    expect(loves[3]).toEqual({
      service: 'lastfm',
      artist: 'New Order',
      title: 'Temptation',
      album: '',
      mbid: null,
      lovedAt: 1609459200,
    });
  });

  test('a single-item page returns track as an object, not an array', () => {
    const { loves, total, returned } = parseLastfmLovedPage({
      lovedtracks: {
        '@attr': { page: '1', perPage: '50', totalPages: '1', total: '1' },
        track: {
          artist: { name: 'Wire' },
          name: 'Map Ref. 41°N 93°W',
          date: { uts: '1704067200' },
        },
      },
    });
    expect(loves).toHaveLength(1);
    expect(loves[0].title).toBe('Map Ref. 41°N 93°W');
    expect(total).toBe(1);
    expect(returned).toBe(1);
  });

  test('a page with no track parses to none, and blank names count as skipped', () => {
    expect(parseLastfmLovedPage({ lovedtracks: { track: [] } })).toMatchObject({
      loves: [], skipped: 0, total: 0, returned: 0,
    });
    const { loves, skipped, returned } = parseLastfmLovedPage({
      lovedtracks: {
        track: [
          { artist: { name: 'No Title' }, date: { uts: '1' } },
          { name: 'No Artist', date: { uts: '1' } },
        ],
      },
    });
    expect(loves).toEqual([]);
    expect(skipped).toBe(2);
    expect(returned).toBe(2);
  });

  test('a missing @attr falls back to the item counts', () => {
    const { total, totalPages } = parseLastfmLovedPage({
      lovedtracks: { track: [{ artist: { name: 'A' }, name: 'B' }] },
    });
    expect(total).toBe(1);
    expect(totalPages).toBeNull();
  });
});

describe('parseListenbrainzFeedbackPage', () => {
  test('a full-metadata item keeps names, release and recording MBID', () => {
    const { loves, total, returned } = parseListenbrainzFeedbackPage(lbFeedback);
    expect(total).toBe(347);
    expect(returned).toBe(5);
    expect(loves[0]).toEqual({
      service: 'listenbrainz',
      artist: 'Sonic Youth',
      title: 'Kool Thing',
      album: 'Goo',
      mbid: '9bd9f6a2-2c27-4d3c-b1d9-6e56a5ee72c2',
      lovedAt: 1735689600,
    });
  });

  test('an item with an MBID but no metadata is kept for the name lookup', () => {
    const { loves } = parseListenbrainzFeedbackPage(lbFeedback);
    expect(loves[1]).toMatchObject({
      service: 'listenbrainz',
      mbid: '1e7b2ec1-6fab-4846-b25e-3dcb4a9f61a9',
      lovedAt: 1725129599,
      needsLookup: true,
    });
  });

  test('an MSID-only row whose metadata MessyBrainz filled arrives with names, matched by name (mbid null)', () => {
    const { loves } = parseListenbrainzFeedbackPage(lbFeedback);
    expect(loves[3]).toEqual({
      service: 'listenbrainz',
      artist: 'New Order',
      title: 'Temptation',
      album: 'Substance',
      mbid: null,
      lovedAt: 1693523558,
    });
  });

  test('a row with neither an MBID nor names is the only skipped one', () => {
    const { loves, skipped, returned } = parseListenbrainzFeedbackPage(lbFeedback);
    expect(returned).toBe(5);
    expect(loves).toHaveLength(4);
    expect(skipped).toBe(1);
  });

  test('without a recording MBID, BOTH names are required: an artist-only item is skipped, not a nameless row', () => {
    const { loves, skipped, returned } = parseListenbrainzFeedbackPage({
      feedback: [
        { created: 1704067200, recording_mbid: null, recording_msid: 'a', track_metadata: { artist_name: 'Only Artist' } },
        { created: 1704067201, recording_mbid: null, recording_msid: 'b', track_metadata: { track_name: 'Only Title' } },
      ],
    });
    expect(returned).toBe(2);
    expect(loves).toEqual([]);
    expect(skipped).toBe(2);
  });

  test('non-Latin metadata survives intact, and an invalid MBID reads as no MBID, not as a failure', () => {
    const { loves } = parseListenbrainzFeedbackPage({
      feedback: [
        {
          created: 1704067200,
          recording_mbid: 'b6d7ec1f-62f6-43dc-a67c-8367f4047d0e',
          track_metadata: { artist_name: '東京事変', track_name: '修羅場', release_name: '大人' },
        },
        {
          created: 1704067201,
          recording_mbid: 'not-a-uuid',
          track_metadata: { artist_name: 'Fiona Apple', track_name: 'Fast As You Can' },
        },
      ],
    });
    expect(loves[0].artist).toBe('東京事変');
    expect(loves[1]).toMatchObject({ artist: 'Fiona Apple', title: 'Fast As You Can', mbid: null });
  });
});
