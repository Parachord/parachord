// Source of truth for plugins/songkick.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  searchArtistEvents: async function (artistName, config) {
    if (!config.apiKey) {
      throw new Error('Songkick API key is required. Apply at https://www.songkick.com/developer');
    }

    const fetchWithRetry = async (url, retries = 2) => {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 429 && retries > 0) {
        await new Promise((r) => setTimeout(r, (3 - retries) * 1000));
        return fetchWithRetry(url, retries - 1);
      }
      return resp;
    };

    // Step 1: Search for the artist to get their Songkick ID
    const searchUrl = `https://api.songkick.com/api/3.0/search/artists.json?apikey=${encodeURIComponent(config.apiKey)}&query=${encodeURIComponent(artistName)}`;

    const searchResponse = await fetchWithRetry(searchUrl);

    if (!searchResponse.ok) {
      if (searchResponse.status === 404 || searchResponse.status === 429) return [];
      throw new Error(`Songkick API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const artists = searchData.resultsPage?.results?.artist;
    if (!artists || artists.length === 0) return [];

    // Find best match (case-insensitive)
    const normalizedQuery = artistName.toLowerCase().trim();
    const match =
      artists.find((a) => a.displayName.toLowerCase().trim() === normalizedQuery) || artists[0];
    const artistId = match.id;

    // Step 2: Get upcoming events for this artist
    const eventsUrl = `https://api.songkick.com/api/3.0/artists/${artistId}/calendar.json?apikey=${encodeURIComponent(config.apiKey)}`;

    const eventsResponse = await fetchWithRetry(eventsUrl);

    if (!eventsResponse.ok) {
      if (eventsResponse.status === 404 || eventsResponse.status === 429) return [];
      throw new Error(`Songkick API error: ${eventsResponse.status}`);
    }

    const eventsData = await eventsResponse.json();
    const events = eventsData.resultsPage?.results?.event;
    if (!events || events.length === 0) return [];

    return events.map((event) => {
      const startDate = event.start?.date || null;
      const startTime = event.start?.time || null;
      const datetime = startDate
        ? startTime
          ? `${startDate}T${startTime}`
          : `${startDate}T00:00:00`
        : null;

      const venue = event.venue || {};
      const location = event.location || {};

      return {
        id: `sk-${event.id}`,
        source: 'songkick',
        artist: artistName,
        title: event.displayName || `${artistName} live`,
        datetime: datetime,
        date: startDate,
        venue: {
          name: venue.displayName || 'TBA',
          city: location.city ? location.city.split(',')[0].trim() : '',
          region:
            location.city && location.city.includes(',')
              ? location.city.split(',').slice(1).join(',').trim()
              : '',
          country: '',
          latitude: venue.lat ? parseFloat(venue.lat) : null,
          longitude: venue.lng ? parseFloat(venue.lng) : null,
        },
        lineup: (event.performance || []).map((p) => p.displayName),
        ticketUrl: event.uri,
        url: event.uri,
        onSale: event.status === 'ok',
        description: event.type || '',
      };
    });
  },
  searchArtist: async function (artistName, config) {
    if (!config.apiKey) {
      throw new Error('Songkick API key is required');
    }

    const searchUrl = `https://api.songkick.com/api/3.0/search/artists.json?apikey=${encodeURIComponent(config.apiKey)}&query=${encodeURIComponent(artistName)}`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!searchResponse.ok) {
      if (searchResponse.status === 404) return null;
      throw new Error(`Songkick API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const artists = searchData.resultsPage?.results?.artist;
    if (!artists || artists.length === 0) return null;

    const normalizedQuery = artistName.toLowerCase().trim();
    const match =
      artists.find((a) => a.displayName.toLowerCase().trim() === normalizedQuery) || artists[0];

    return {
      id: match.id,
      name: match.displayName,
      url: match.uri,
      onTourUntil: match.onTourUntil,
    };
  },
};
