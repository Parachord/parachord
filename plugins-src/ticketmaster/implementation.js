// Source of truth for plugins/ticketmaster.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  searchArtistEvents: async function (artistName, config) {
    if (!config.apiKey) {
      throw new Error(
        'Ticketmaster API Key is required. Get one at https://developer-acct.ticketmaster.com',
      );
    }

    const fetchWithRetry = async (url, retries = 2) => {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 429 && retries > 0) {
        const wait = (3 - retries) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        return fetchWithRetry(url, retries - 1);
      }
      return resp;
    };

    const normalizedQuery = artistName.toLowerCase().trim();

    // Step 1: Resolve artist to their Ticketmaster attraction ID
    // This prevents false positives from tribute bands, mashups, etc.
    const attractionUrl = `https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=${encodeURIComponent(artistName)}&classificationName=music&size=5&apikey=${encodeURIComponent(config.apiKey)}`;
    const attractionResp = await fetchWithRetry(attractionUrl);
    if (!attractionResp.ok) {
      if (attractionResp.status === 404 || attractionResp.status === 429) return [];
      if (attractionResp.status === 401) throw new Error('Invalid Ticketmaster API key');
      throw new Error(`Ticketmaster API error: ${attractionResp.status}`);
    }
    const attractionData = await attractionResp.json();
    const attractions = (attractionData._embedded && attractionData._embedded.attractions) || [];
    const exactMatch = attractions.find((a) => a.name.toLowerCase().trim() === normalizedQuery);
    if (!exactMatch) return [];

    // Step 2: Query events by attraction ID (not keyword) for precise results
    const now = new Date().toISOString().split('.')[0] + 'Z';
    const url = `https://app.ticketmaster.com/discovery/v2/events.json?attractionId=${encodeURIComponent(exactMatch.id)}&classificationName=music&sort=date,asc&size=50&startDateTime=${encodeURIComponent(now)}&apikey=${encodeURIComponent(config.apiKey)}`;

    const response = await fetchWithRetry(url);

    if (!response.ok) {
      if (response.status === 404) return [];
      if (response.status === 429) return [];
      throw new Error(`Ticketmaster API error: ${response.status}`);
    }

    const data = await response.json();
    const events = data._embedded && data._embedded.events;
    if (!events || events.length === 0) return [];

    return events.map((event) => {
      const venue = (event._embedded && event._embedded.venues && event._embedded.venues[0]) || {};
      const eventAttractions = (event._embedded && event._embedded.attractions) || [];
      const dates = event.dates || {};
      const start = dates.start || {};
      const location = venue.location || {};
      const status = dates.status || {};

      return {
        id: `tm-${event.id}`,
        source: 'ticketmaster',
        artist: artistName,
        title: event.name || `${artistName} live`,
        datetime:
          start.dateTime ||
          (start.localDate
            ? start.localDate + (start.localTime ? 'T' + start.localTime : '')
            : null),
        date: start.localDate || (start.dateTime ? start.dateTime.split('T')[0] : null),
        venue: {
          name: venue.name || 'TBA',
          city: (venue.city && venue.city.name) || '',
          region: (venue.state && venue.state.stateCode) || '',
          country: (venue.country && venue.country.countryCode) || '',
          latitude: location.latitude ? parseFloat(location.latitude) : null,
          longitude: location.longitude ? parseFloat(location.longitude) : null,
        },
        lineup: eventAttractions.map((a) => a.name),
        ticketUrl: event.url,
        url: event.url,
        onSale: status.code === 'onsale',
        description: '',
      };
    });
  },
  searchArtist: async function (artistName, config) {
    if (!config.apiKey) {
      throw new Error('Ticketmaster API Key is required');
    }

    const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?keyword=${encodeURIComponent(artistName)}&classificationName=music&size=5&apikey=${encodeURIComponent(config.apiKey)}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Ticketmaster API error: ${response.status}`);
    }

    const data = await response.json();
    const attractions = data._embedded && data._embedded.attractions;
    if (!attractions || attractions.length === 0) return null;

    const normalizedQuery = artistName.toLowerCase().trim();
    const match =
      attractions.find((a) => a.name.toLowerCase().trim() === normalizedQuery) || attractions[0];
    const images = match.images || [];
    const image = images.find((i) => i.ratio === '16_9' && i.width > 500) || images[0];

    return {
      id: match.id,
      name: match.name,
      slug: match.id,
      url: match.url,
      imageUrl: image ? image.url : null,
      hasUpcomingEvents: match.upcomingEvents && match.upcomingEvents._total > 0,
      score: 0,
    };
  },
};
