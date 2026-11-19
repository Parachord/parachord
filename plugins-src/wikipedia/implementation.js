// Wikipedia plug-in (plugins/wikipedia.axe). Edit here, bump manifest.version
// in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function): the one shared scope is the _lib factory below, which every
// method reaches as this.lib (helpers and constants only; per-instance state
// lives on `this`).
module.exports = {
  _lib: function () {
    // ── Finding the artist's Wikidata entry ──
    // The bio starts from the artist's Wikidata id. It used to come only from
    // the artist's MusicBrainz url-rels, so a MusicBrainz outage took the bio
    // down with it (Wild Pink, 2026-10-25). Wikidata records the MusicBrainz
    // artist id itself (property P434), so it is asked first; the MusicBrainz
    // url-rels are the fallback for an artist Wikidata has no P434 for.
    var MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var WIKIDATA_ID_RE = /^Q\d+$/;
    var isMbid = function (value) { return typeof value === 'string' && MBID_RE.test(value); };

    // Wikidata's search with a haswbstatement filter: the entity whose
    // "MusicBrainz artist ID" (P434) is this mbid. The mbid is validated
    // first, so nothing else reaches the search expression.
    var wikidataSearchUrl = function (mbid) {
      if (!isMbid(mbid)) return null;
      var query = 'haswbstatement:P434=' + mbid.toLowerCase();
      return 'https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&srlimit=1&format=json&origin=*';
    };
    var wikidataIdFromSearch = function (data) {
      var hit = data && data.query && data.query.search && data.query.search[0];
      var title = hit && hit.title;
      return typeof title === 'string' && WIKIDATA_ID_RE.test(title) ? title : null;
    };
    // A MusicBrainz artist lookup with inc=url-rels.
    var wikidataIdFromMbRelations = function (mbData) {
      var rels = (mbData && mbData.relations) || [];
      for (var i = 0; i < rels.length; i++) {
        var r = rels[i];
        if (r && r.type === 'wikidata' && r.url && r.url.resource) {
          var id = String(r.url.resource).split('/').pop();
          return WIKIDATA_ID_RE.test(id) ? id : null;
        }
      }
      return null;
    };

    // ── Turning the article into a bio ──
    // The whole plain-text article, trimmed to the lead plus the prose
    // sections (desktop once took the lead alone: Wild Pink's is one
    // sentence, 2026-10-25):
    // - a lead of LEAD_ENOUGH_WORDS or more is the whole bio;
    // - otherwise prose paragraphs from the sections that follow are added,
    //   in article order, until the bio reaches TARGET_WORDS (whole
    //   paragraphs only);
    // - sections that are not a bio (DROP_SECTION_RE) are skipped with all
    //   their subsections;
    // - inside a kept section only prose survives: a paragraph of at least
    //   MIN_PROSE_WORDS that ends like a sentence (list items don't);
    // - headings are dropped; paragraphs are separated by a blank line.
    var LEAD_ENOUGH_WORDS = 150;
    var TARGET_WORDS = 400;
    var MIN_PROSE_WORDS = 4;
    var DROP_SECTION_RE = new RegExp(
      '^(?:' + [
        'references', 'external links', 'see also', 'notes', 'notes and references', 'further reading',
        'bibliography', 'sources', 'citations', 'footnotes', 'works cited',
        'discography', 'selected discography', 'filmography', 'videography',
        '(?:band )?members', 'personnel', 'line-?up',
        '(?:concert )?tours', 'tours and concerts',
        'accolades', 'awards(?: and (?:nominations|honou?rs|accolades))?', 'honou?rs',
        'timeline(?: of .*)?', 'lists? of .*'
      ].join('|') + ')$',
      'i'
    );
    var HEADING_RE = /^(={2,6})\s*(.+?)\s*\1\s*$/;
    var SENTENCE_END_RE = /[.!?…]["'”’)\]]*$/;
    var wordCount = function (text) { return (String(text).match(/\S+/g) || []).length; };
    var isProse = function (paragraph) {
      return SENTENCE_END_RE.test(paragraph) && wordCount(paragraph) >= MIN_PROSE_WORDS;
    };

    // The plain-text extract (prop=extracts&explaintext=1) into its lead and
    // its sections, each a list of non-empty lines.
    var splitExtract = function (extract) {
      var lead = [];
      var sections = [];
      var current = null;
      String(extract || '').split('\n').forEach(function (raw) {
        var line = raw.trim();
        if (!line) return;
        var heading = line.match(HEADING_RE);
        if (heading) {
          current = { level: heading[1].length, title: heading[2], paragraphs: [] };
          sections.push(current);
        } else if (current) {
          current.paragraphs.push(line);
        } else {
          lead.push(line);
        }
      });
      return { lead: lead, sections: sections };
    };

    // The bio text, or null when the article has nothing to show.
    var bioFromExtract = function (extract, opts) {
      var leadEnoughWords = (opts && opts.leadEnoughWords) || LEAD_ENOUGH_WORDS;
      var targetWords = (opts && opts.targetWords) || TARGET_WORDS;
      var parts = splitExtract(extract);
      var paragraphs = parts.lead.slice();
      var words = wordCount(parts.lead.join(' '));
      if (words < leadEnoughWords) {
        var droppingBelowLevel = 0; // inside a dropped section: skip until a heading at this level or above
        for (var s = 0; s < parts.sections.length; s++) {
          var section = parts.sections[s];
          if (words >= targetWords) break;
          if (droppingBelowLevel && section.level > droppingBelowLevel) continue;
          droppingBelowLevel = DROP_SECTION_RE.test(section.title) ? section.level : 0;
          if (droppingBelowLevel) continue;
          for (var p = 0; p < section.paragraphs.length; p++) {
            var paragraph = section.paragraphs[p];
            if (words >= targetWords) break;
            if (!isProse(paragraph)) continue;
            paragraphs.push(paragraph);
            words += wordCount(paragraph);
          }
        }
      }
      return paragraphs.length ? paragraphs.join('\n\n') : null;
    };

    return {
      isMbid: isMbid,
      wikidataSearchUrl: wikidataSearchUrl,
      wikidataIdFromSearch: wikidataIdFromSearch,
      wikidataIdFromMbRelations: wikidataIdFromMbRelations,
      splitExtract: splitExtract,
      isProse: isProse,
      bioFromExtract: bioFromExtract,
      DROP_SECTION_RE: DROP_SECTION_RE,
      LEAD_ENOUGH_WORDS: LEAD_ENOUGH_WORDS,
      TARGET_WORDS: TARGET_WORDS,
      MIN_PROSE_WORDS: MIN_PROSE_WORDS
    };
  },

  // The artist's Wikidata id: Wikidata's own P434 first, MusicBrainz's
  // url-rels as the fallback (in the app's background lane: a bio is never
  // what the user clicked for). A found id is kept for the session on the
  // instance; a miss isn't (it may be an outage). null when neither knows
  // the artist; THROWS when MusicBrainz can't be reached after Wikidata failed.
  lookupWikidataId: async function (mbid) {
    var lib = this.lib;
    if (!lib.isMbid(mbid)) return null;
    var key = mbid.toLowerCase();
    if (!this._wikidataIds) this._wikidataIds = {};
    if (this._wikidataIds[key]) return this._wikidataIds[key];
    var id = null;
    try {
      var res = await fetch(lib.wikidataSearchUrl(key));
      if (res.ok) id = lib.wikidataIdFromSearch(await res.json());
    } catch (_e) {
      // Wikidata unreachable: MusicBrainz may still answer.
    }
    if (!id) {
      var mb = await fetch('https://musicbrainz.org/ws/2/artist/' + key + '?inc=url-rels&fmt=json', {
        headers: { 'User-Agent': 'Parachord/1.0 (https://parachord.app)' },
        mbBackground: true
      });
      if (mb.status === 404) return null;
      if (!mb.ok) throw new Error('Wikipedia bio: MusicBrainz lookup failed: ' + mb.status);
      id = lib.wikidataIdFromMbRelations(await mb.json());
    }
    if (id) this._wikidataIds[key] = id;
    return id;
  },

  // The biography capability (#1539 step 6), moved out of app.js
  // (getWikipediaBio). artist: { name, mbid }. Needs the MusicBrainz id: the
  // article is found through Wikidata. Answers { text, url } (the article
  // trimmed by bioFromExtract), or null when there's no MBID, no Wikidata
  // entry, no English article or nothing to show. A failed request THROWS.
  getArtistBio: async function (artist) {
    var mbid = artist && artist.mbid;
    if (!this.lib.isMbid(mbid)) return null;
    var wikidataId = await this.lookupWikidataId(mbid);
    if (!wikidataId) return null;
    var wd = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=' + encodeURIComponent(wikidataId) +
      '&props=sitelinks&sitefilter=enwiki&format=json&origin=*');
    if (!wd.ok) throw new Error('Wikipedia bio: Wikidata lookup failed: ' + wd.status);
    var wdData = await wd.json();
    var entity = wdData && wdData.entities && wdData.entities[wikidataId];
    var title = entity && entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
    if (!title) return null;
    var wp = await fetch('https://en.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(title) +
      '&prop=extracts&explaintext=1&format=json&origin=*');
    if (!wp.ok) throw new Error('Wikipedia bio: article fetch failed: ' + wp.status);
    var wpData = await wp.json();
    var pages = wpData && wpData.query && wpData.query.pages;
    var pageId = pages ? Object.keys(pages)[0] : null;
    var extract = pageId && pageId !== '-1' ? pages[pageId].extract : null;
    var text = extract ? this.lib.bioFromExtract(extract) : null;
    if (!text) return null;
    return { text: text, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')) };
  }
};
