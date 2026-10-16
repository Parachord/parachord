// Source of truth for plugins/seatgeek.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  searchArtistEvents: async function (artistName, config) {
    if (!config.clientId) {
      throw new Error(
        'SeatGeek Client ID is required. Get one at http://seatgeek.com/account/develop',
      );
    }

    const fetchWithRetry = async (url, retries = 2) => {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 429 && retries > 0) {
        await new Promise((r) => setTimeout(r, (3 - retries) * 1000));
        return fetchWithRetry(url, retries - 1);
      }
      return resp;
    };

    // Step 1: Search for the performer to get their slug
    const searchUrl = `https://api.seatgeek.com/2/performers?q=${encodeURIComponent(artistName)}&client_id=${encodeURIComponent(config.clientId)}`;

    const searchResponse = await fetchWithRetry(searchUrl);

    if (!searchResponse.ok) {
      if (searchResponse.status === 404 || searchResponse.status === 429) return [];
      throw new Error(`SeatGeek API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const performers = searchData.performers;
    if (!performers || performers.length === 0) return [];

    // Find exact match only (case-insensitive) — no fallback to avoid tribute band false positives
    const normalizedQuery = artistName.toLowerCase().trim();
    const match = performers.find((p) => p.name.toLowerCase().trim() === normalizedQuery);
    if (!match) return [];
    const performerSlug = match.slug;

    // Step 2: Get upcoming events for this performer
    const now = new Date().toISOString().split('T')[0];
    const eventsUrl = `https://api.seatgeek.com/2/events?performers.slug=${encodeURIComponent(performerSlug)}&datetime_utc.gte=${now}&sort=datetime_utc.asc&per_page=50&client_id=${encodeURIComponent(config.clientId)}`;

    const eventsResponse = await fetchWithRetry(eventsUrl);

    if (!eventsResponse.ok) {
      if (eventsResponse.status === 404 || eventsResponse.status === 429) return [];
      throw new Error(`SeatGeek API error: ${eventsResponse.status}`);
    }

    const eventsData = await eventsResponse.json();
    const events = eventsData.events;
    if (!events || events.length === 0) return [];

    return events.map((event) => {
      const venue = event.venue || {};
      const location = venue.location || {};

      return {
        id: `sg-${event.id}`,
        source: 'seatgeek',
        artist: artistName,
        title: event.title || event.short_title || `${artistName} live`,
        datetime: event.datetime_local || event.datetime_utc || null,
        date: event.datetime_local
          ? event.datetime_local.split('T')[0]
          : event.datetime_utc
            ? event.datetime_utc.split('T')[0]
            : null,
        venue: {
          name: venue.name || 'TBA',
          city: venue.city || '',
          region: venue.state || '',
          country: venue.country || '',
          latitude: location.lat ? parseFloat(location.lat) : null,
          longitude: location.lon ? parseFloat(location.lon) : null,
        },
        lineup: (event.performers || []).map((p) => p.name),
        ticketUrl: event.url,
        url: event.url,
        onSale: event.stats && event.stats.listing_count > 0,
        description:
          event.taxonomies && event.taxonomies.length > 0 ? event.taxonomies[0].name : '',
      };
    });
  },
  searchArtist: async function (artistName, config) {
    if (!config.clientId) {
      throw new Error('SeatGeek Client ID is required');
    }

    const searchUrl = `https://api.seatgeek.com/2/performers?q=${encodeURIComponent(artistName)}&client_id=${encodeURIComponent(config.clientId)}`;

    const searchResponse = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!searchResponse.ok) {
      if (searchResponse.status === 404) return null;
      throw new Error(`SeatGeek API error: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const performers = searchData.performers;
    if (!performers || performers.length === 0) return null;

    const normalizedQuery = artistName.toLowerCase().trim();
    const match =
      performers.find((p) => p.name.toLowerCase().trim() === normalizedQuery) || performers[0];

    return {
      id: match.id,
      name: match.name,
      slug: match.slug,
      url: match.url,
      imageUrl: match.image,
      hasUpcomingEvents: match.has_upcoming_events,
      score: match.score,
    };
  },
};
