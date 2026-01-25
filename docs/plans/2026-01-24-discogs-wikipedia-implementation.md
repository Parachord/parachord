# Discogs & Wikipedia Metaservice Plugins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Wikipedia and Discogs metaservice plugins for artist biographies and fallback images.

**Architecture:** Two new `.axe` plugin files define the services. Bio fetching in `app.js` uses parallel Promise.all with priority selection (Wikipedia > Discogs > Last.fm). Image fetching adds Wikipedia and Discogs as fallbacks after Spotify.

**Tech Stack:** Wikipedia REST API, Wikidata API, Discogs API, React (createElement), existing metaservice patterns

---

## Task 1: Create Wikipedia Metaservice Plugin

**Files:**
- Create: `resolvers/wikipedia.axe`

**Step 1: Create the wikipedia.axe file**

```json
{
  "manifest": {
    "id": "wikipedia",
    "name": "Wikipedia",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Artist biographies and images from Wikipedia",
    "icon": "📚",
    "color": "#000000",
    "homepage": "https://www.wikipedia.org"
  },
  "capabilities": {
    "metadata": true,
    "biography": true,
    "artistImages": true
  },
  "settings": {
    "requiresAuth": false,
    "authType": "none",
    "configurable": {}
  }
}
```

**Step 2: Verify file is valid JSON**

Run: `cat resolvers/wikipedia.axe | jq .`
Expected: Formatted JSON output, no errors

**Step 3: Commit**

```bash
git add resolvers/wikipedia.axe
git commit -m "feat: add Wikipedia metaservice plugin manifest"
```

---

## Task 2: Create Discogs Metaservice Plugin

**Files:**
- Create: `resolvers/discogs.axe`

**Step 1: Create the discogs.axe file**

```json
{
  "manifest": {
    "id": "discogs",
    "name": "Discogs",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Artist biographies and images from Discogs",
    "icon": "📀",
    "color": "#333333",
    "homepage": "https://www.discogs.com"
  },
  "capabilities": {
    "metadata": true,
    "biography": true,
    "artistImages": true
  },
  "settings": {
    "requiresAuth": false,
    "authType": "token",
    "configurable": {
      "personalAccessToken": {
        "type": "password",
        "label": "Personal Access Token",
        "required": false,
        "advanced": true,
        "placeholder": "Optional - improves rate limits",
        "description": "Get a token from discogs.com/settings/developers",
        "helpUrl": "https://www.discogs.com/settings/developers"
      }
    }
  }
}
```

**Step 2: Verify file is valid JSON**

Run: `cat resolvers/discogs.axe | jq .`
Expected: Formatted JSON output, no errors

**Step 3: Commit**

```bash
git add resolvers/discogs.axe
git commit -m "feat: add Discogs metaservice plugin manifest"
```

---

## Task 3: Add Wikipedia Bio Fetch Function

**Files:**
- Modify: `app.js` (add after `getArtistBio` function, around line 11653)

**Step 1: Add getWikipediaBio function**

Insert after the existing `getArtistBio` function (around line 11653):

```javascript
  // Fetch artist biography from Wikipedia via Wikidata (uses MBID)
  const getWikipediaBio = async (artistMbid) => {
    if (!artistMbid) {
      console.log('📚 Wikipedia bio skipped: no MBID');
      return null;
    }

    try {
      // Step 1: Query MusicBrainz for Wikidata relation
      const mbUrl = `https://musicbrainz.org/ws/2/artist/${artistMbid}?inc=url-rels&fmt=json`;
      const mbResponse = await fetch(mbUrl, {
        headers: { 'User-Agent': 'Parachord/1.0 (https://parachord.app)' }
      });

      if (!mbResponse.ok) {
        console.log('📚 MusicBrainz artist lookup failed:', mbResponse.status);
        return null;
      }

      const mbData = await mbResponse.json();

      // Find Wikidata URL in relations
      const wikidataRel = mbData.relations?.find(r =>
        r.type === 'wikidata' && r.url?.resource
      );

      if (!wikidataRel) {
        console.log('📚 No Wikidata link found for artist');
        return null;
      }

      // Extract Wikidata ID (e.g., "Q1299" from "https://www.wikidata.org/wiki/Q1299")
      const wikidataUrl = wikidataRel.url.resource;
      const wikidataId = wikidataUrl.split('/').pop();

      // Step 2: Query Wikidata for Wikipedia article title
      const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`;
      const wdResponse = await fetch(wdUrl);

      if (!wdResponse.ok) {
        console.log('📚 Wikidata lookup failed:', wdResponse.status);
        return null;
      }

      const wdData = await wdResponse.json();
      const wikiTitle = wdData.entities?.[wikidataId]?.sitelinks?.enwiki?.title;

      if (!wikiTitle) {
        console.log('📚 No English Wikipedia article found');
        return null;
      }

      // Step 3: Fetch Wikipedia article summary
      const wpUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
      const wpResponse = await fetch(wpUrl);

      if (!wpResponse.ok) {
        console.log('📚 Wikipedia summary fetch failed:', wpResponse.status);
        return null;
      }

      const wpData = await wpResponse.json();

      if (wpData.extract) {
        console.log('📚 Wikipedia bio fetched successfully');
        return {
          bio: wpData.extract,
          url: wpData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`,
          source: 'wikipedia'
        };
      }

      return null;
    } catch (error) {
      console.error('📚 Failed to fetch Wikipedia bio:', error);
      return null;
    }
  };
```

**Step 2: Test that the app still loads**

Run: `npm start` (or however the app is started)
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add getWikipediaBio function for Wikipedia artist bios"
```

---

## Task 4: Add Discogs Bio Fetch Function

**Files:**
- Modify: `app.js` (add after `getWikipediaBio` function)

**Step 1: Add getDiscogsBio function**

Insert after the `getWikipediaBio` function:

```javascript
  // Fetch artist biography from Discogs (uses MBID or artist name)
  const getDiscogsBio = async (artistMbid, artistName) => {
    if (!artistMbid && !artistName) {
      console.log('📀 Discogs bio skipped: no MBID or name');
      return null;
    }

    try {
      // Get Discogs token from metaservice config if available
      const discogsConfig = metaServiceConfigs?.discogs || {};
      const token = discogsConfig.personalAccessToken;

      const headers = {
        'User-Agent': 'Parachord/1.0 (https://parachord.app)'
      };
      if (token) {
        headers['Authorization'] = `Discogs token=${token}`;
      }

      // Search for artist on Discogs
      const searchQuery = artistName || artistMbid;
      const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(searchQuery)}&type=artist&per_page=5`;

      const searchResponse = await fetch(searchUrl, { headers });

      if (!searchResponse.ok) {
        console.log('📀 Discogs search failed:', searchResponse.status);
        return null;
      }

      const searchData = await searchResponse.json();

      if (!searchData.results?.length) {
        console.log('📀 No Discogs results found');
        return null;
      }

      // Find best match - prefer exact name match
      let artistResult = searchData.results.find(r =>
        r.title?.toLowerCase() === artistName?.toLowerCase()
      );

      // Fall back to first result if no exact match
      if (!artistResult) {
        artistResult = searchData.results[0];
      }

      // Fetch full artist profile
      const artistUrl = artistResult.resource_url;
      const artistResponse = await fetch(artistUrl, { headers });

      if (!artistResponse.ok) {
        console.log('📀 Discogs artist fetch failed:', artistResponse.status);
        return null;
      }

      const artistData = await artistResponse.json();

      if (artistData.profile) {
        // Clean up Discogs profile (remove [a=Artist] style links)
        const cleanProfile = artistData.profile
          .replace(/\[a=([^\]]+)\]/g, '$1')  // [a=Artist Name] -> Artist Name
          .replace(/\[l=([^\]]+)\]/g, '$1')  // [l=Label Name] -> Label Name
          .replace(/\[m=([^\]]+)\]/g, '$1')  // [m=Master] -> Master
          .replace(/\[r=([^\]]+)\]/g, '$1')  // [r=Release] -> Release
          .replace(/\[url=([^\]]+)\]([^\[]+)\[\/url\]/g, '$2')  // [url=...]text[/url] -> text
          .trim();

        console.log('📀 Discogs bio fetched successfully');
        return {
          bio: cleanProfile,
          url: artistData.uri || `https://www.discogs.com/artist/${artistData.id}`,
          source: 'discogs'
        };
      }

      return null;
    } catch (error) {
      console.error('📀 Failed to fetch Discogs bio:', error);
      return null;
    }
  };
```

**Step 2: Test that the app still loads**

Run: `npm start`
Expected: App loads without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add getDiscogsBio function for Discogs artist bios"
```

---

## Task 5: Refactor getArtistBio for Multi-Source Fetching

**Files:**
- Modify: `app.js` (refactor existing `getArtistBio` function at lines 11614-11653)

**Step 1: Rename existing function to getLastfmBio**

Change the existing `getArtistBio` function name to `getLastfmBio` (around line 11615):

```javascript
  // Fetch artist biography from Last.fm (lazy loaded on Biography tab click)
  const getLastfmBio = async (artistName) => {
```

And update the return to include source:

```javascript
        return { bio: cleanBio, url: lastfmUrl, source: 'lastfm' };
```

**Step 2: Add new getArtistBio that orchestrates all sources**

Add after the three individual fetch functions (getLastfmBio, getWikipediaBio, getDiscogsBio):

```javascript
  // Fetch artist biography from all sources with priority: Wikipedia > Discogs > Last.fm
  const getArtistBio = async (artistName, artistMbid) => {
    if (!artistName) return null;

    setLoadingBio(true);
    try {
      // Fetch from all sources in parallel
      const [wikipediaBio, discogsBio, lastfmBio] = await Promise.all([
        getWikipediaBio(artistMbid),
        getDiscogsBio(artistMbid, artistName),
        getLastfmBio(artistName)
      ]);

      // Store all sources for potential future use
      const allSources = {};
      if (wikipediaBio) allSources.wikipedia = wikipediaBio;
      if (discogsBio) allSources.discogs = discogsBio;
      if (lastfmBio) allSources.lastfm = lastfmBio;

      // Select best bio based on priority: Wikipedia > Discogs > Last.fm
      const selected = wikipediaBio ?? discogsBio ?? lastfmBio;

      if (selected) {
        console.log(`🎤 Selected bio from ${selected.source}`);
        return { ...selected, allSources };
      }

      console.log('🎤 No biography found from any source');
      return null;
    } catch (error) {
      console.error('Failed to fetch artist bio:', error);
      return null;
    } finally {
      setLoadingBio(false);
    }
  };
```

**Step 3: Update all getArtistBio call sites to pass mbid**

Find and update these locations:

Line ~2456:
```javascript
        const bioData = await getArtistBio(currentArtist.name, currentArtist.mbid);
```

Line ~15179:
```javascript
                      const bioData = await getArtistBio(currentArtist.name, currentArtist.mbid);
```

Line ~15241:
```javascript
                      const bioData = await getArtistBio(currentArtist.name, currentArtist.mbid);
```

**Step 4: Remove setLoadingBio from getLastfmBio**

Since the orchestrator handles loading state, remove these lines from `getLastfmBio`:
- Remove: `setLoadingBio(true);` at the start
- Remove: the `finally` block with `setLoadingBio(false);`

**Step 5: Test that bio fetching works**

Run: `npm start`
Test: Navigate to an artist with MBID, click Biography tab
Expected: Bio loads (check console for source log)

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat: refactor getArtistBio for multi-source fetching with priority"
```

---

## Task 6: Update Bio UI to Show Source Attribution

**Files:**
- Modify: `app.js` (bio rendering around lines 15928-15939)

**Step 1: Update bio content rendering to show source**

Replace the existing bio content section (around lines 15929-15938):

```javascript
            // Bio content
            !loadingBio && artistBio && React.createElement('div', { className: 'space-y-4' },
              React.createElement('div', {
                className: 'text-sm text-gray-700 leading-relaxed whitespace-pre-wrap'
              }, artistBio.bio),
              // Source attribution and link
              React.createElement('div', { className: 'flex items-center gap-2 mt-4' },
                React.createElement('span', {
                  className: 'text-xs text-gray-400'
                }, `From ${artistBio.source === 'wikipedia' ? 'Wikipedia' : artistBio.source === 'discogs' ? 'Discogs' : 'Last.fm'}`),
                artistBio.url && React.createElement('a', {
                  href: artistBio.url,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  className: 'text-purple-600 hover:text-purple-700 text-sm'
                }, 'Read more →')
              )
            ),
```

**Step 2: Test the UI**

Run: `npm start`
Test: Navigate to artist, click Biography tab
Expected: See "From Wikipedia" / "From Discogs" / "From Last.fm" with link

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: show bio source attribution in artist biography tab"
```

---

## Task 7: Add Wikipedia Artist Image Fallback

**Files:**
- Modify: `app.js` (add after `getWikipediaBio` function)

**Step 1: Add getWikipediaArtistImage function**

```javascript
  // Fetch artist image from Wikipedia/Wikidata (fallback when Spotify has no image)
  const getWikipediaArtistImage = async (artistMbid) => {
    if (!artistMbid) return null;

    try {
      // Step 1: Get Wikidata ID via MusicBrainz
      const mbUrl = `https://musicbrainz.org/ws/2/artist/${artistMbid}?inc=url-rels&fmt=json`;
      const mbResponse = await fetch(mbUrl, {
        headers: { 'User-Agent': 'Parachord/1.0 (https://parachord.app)' }
      });

      if (!mbResponse.ok) return null;

      const mbData = await mbResponse.json();
      const wikidataRel = mbData.relations?.find(r =>
        r.type === 'wikidata' && r.url?.resource
      );

      if (!wikidataRel) return null;

      const wikidataId = wikidataRel.url.resource.split('/').pop();

      // Step 2: Get Wikipedia article title
      const wdUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&props=sitelinks&sitefilter=enwiki&format=json&origin=*`;
      const wdResponse = await fetch(wdUrl);

      if (!wdResponse.ok) return null;

      const wdData = await wdResponse.json();
      const wikiTitle = wdData.entities?.[wikidataId]?.sitelinks?.enwiki?.title;

      if (!wikiTitle) return null;

      // Step 3: Fetch Wikipedia page summary (includes thumbnail)
      const wpUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
      const wpResponse = await fetch(wpUrl);

      if (!wpResponse.ok) return null;

      const wpData = await wpResponse.json();

      if (wpData.thumbnail?.source) {
        console.log('📚 Wikipedia artist image found');
        return wpData.thumbnail.source;
      }

      return null;
    } catch (error) {
      console.error('📚 Failed to fetch Wikipedia artist image:', error);
      return null;
    }
  };
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add getWikipediaArtistImage for image fallback"
```

---

## Task 8: Add Discogs Artist Image Fallback

**Files:**
- Modify: `app.js` (add after `getWikipediaArtistImage` function)

**Step 1: Add getDiscogsArtistImage function**

```javascript
  // Fetch artist image from Discogs (fallback when Spotify and Wikipedia have no image)
  const getDiscogsArtistImage = async (artistMbid, artistName) => {
    if (!artistName) return null;

    try {
      const discogsConfig = metaServiceConfigs?.discogs || {};
      const token = discogsConfig.personalAccessToken;

      const headers = {
        'User-Agent': 'Parachord/1.0 (https://parachord.app)'
      };
      if (token) {
        headers['Authorization'] = `Discogs token=${token}`;
      }

      // Search for artist
      const searchUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(artistName)}&type=artist&per_page=5`;
      const searchResponse = await fetch(searchUrl, { headers });

      if (!searchResponse.ok) return null;

      const searchData = await searchResponse.json();

      if (!searchData.results?.length) return null;

      // Find best match
      let artistResult = searchData.results.find(r =>
        r.title?.toLowerCase() === artistName.toLowerCase()
      ) || searchData.results[0];

      // Fetch full artist profile for images
      const artistResponse = await fetch(artistResult.resource_url, { headers });

      if (!artistResponse.ok) return null;

      const artistData = await artistResponse.json();

      // Discogs images array - first is primary
      if (artistData.images?.length > 0) {
        // Prefer primary image, fall back to first
        const primaryImage = artistData.images.find(img => img.type === 'primary');
        const imageUrl = primaryImage?.uri || artistData.images[0].uri;
        console.log('📀 Discogs artist image found');
        return imageUrl;
      }

      return null;
    } catch (error) {
      console.error('📀 Failed to fetch Discogs artist image:', error);
      return null;
    }
  };
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add getDiscogsArtistImage for image fallback"
```

---

## Task 9: Integrate Image Fallbacks into getArtistImage

**Files:**
- Modify: `app.js` (modify existing `getArtistImage` function around line 11481)

**Step 1: Add fallback logic to getArtistImage**

Find the end of the Spotify image fetch logic in `getArtistImage` (around where it caches and returns). Add fallback logic before the final return null.

After the Spotify fetch try/catch block but before the final cleanup, add:

```javascript
        // Spotify returned no image, try fallbacks
        console.log('🎨 No Spotify image, trying Wikipedia fallback');

        // We need MBID for Wikipedia - fetch it if we don't have it cached
        // For now, we'll skip this in getArtistImage and handle in artist page load
        // TODO: Could enhance by looking up MBID here

        return null;
```

**Note:** The image fallback is better handled at the artist page level where we already have the MBID. Let's modify the approach.

**Step 2: Modify artist page image loading to include fallbacks**

Find where `getArtistImage` is called (around line 7119) and update the image loading flow:

```javascript
      // Start fetching artist image early (non-blocking) with fallbacks
      (async () => {
        // Try Spotify first
        const spotifyResult = await getArtistImage(artistName);
        if (spotifyResult) {
          setArtistImage(spotifyResult.url);
          setArtistImagePosition(spotifyResult.facePosition || 'center 25%');
          return;
        }

        // Try Wikipedia fallback
        const wikiImage = await getWikipediaArtistImage(artist.id);
        if (wikiImage) {
          setArtistImage(wikiImage);
          setArtistImagePosition('center 25%');
          return;
        }

        // Try Discogs fallback
        const discogsImage = await getDiscogsArtistImage(artist.id, artistName);
        if (discogsImage) {
          setArtistImage(discogsImage);
          setArtistImagePosition('center 25%');
        }
      })();
```

**Step 3: Test image fallback flow**

Run: `npm start`
Test: Find an artist without Spotify image but with Wikipedia/Discogs presence
Expected: Image loads from fallback source

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add Wikipedia and Discogs image fallbacks to artist page"
```

---

## Task 10: Final Testing and Cleanup

**Step 1: Test full flow with artist that has all sources**

Run: `npm start`
Test with well-known artist (e.g., "The Beatles"):
- Navigate to artist page
- Check image loads
- Click Biography tab
- Verify Wikipedia bio shows with attribution
- Check console for source logs

**Step 2: Test fallback behavior**

Test with artist that only has Last.fm:
- Find lesser-known artist without Wikipedia page
- Verify Last.fm bio shows as fallback
- Verify "From Last.fm" attribution

**Step 3: Test Discogs token (optional)**

- Go to Settings > Meta Services > Discogs
- Add personal access token
- Verify bio/images still work

**Step 4: Final commit**

```bash
git add -A
git status
# If any uncommitted changes:
git commit -m "chore: final cleanup for Discogs/Wikipedia metaservices"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create Wikipedia plugin manifest | `resolvers/wikipedia.axe` |
| 2 | Create Discogs plugin manifest | `resolvers/discogs.axe` |
| 3 | Add Wikipedia bio fetch function | `app.js` |
| 4 | Add Discogs bio fetch function | `app.js` |
| 5 | Refactor getArtistBio for multi-source | `app.js` |
| 6 | Update bio UI for source attribution | `app.js` |
| 7 | Add Wikipedia image fallback | `app.js` |
| 8 | Add Discogs image fallback | `app.js` |
| 9 | Integrate image fallbacks | `app.js` |
| 10 | Final testing and cleanup | All |
