// Source of truth for plugins/bandsintown.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  searchArtistEvents: async function (artistName, config) {
    if (!config.appId) {
      throw new Error(
        'Bandsintown App ID is required. See https://help.artists.bandsintown.com/en/articles/7053475-what-is-the-bandsintown-api',
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

    const encodedArtist = encodeURIComponent(artistName);
    const url = `https://rest.bandsintown.com/artists/${encodedArtist}/events?app_id=${encodeURIComponent(config.appId)}&date=upcoming`;

    const response = await fetchWithRetry(url);

    if (!response.ok) {
      if (response.status === 404 || response.status === 429) return [];
      throw new Error(`Bandsintown API error: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data.map((event) => ({
      id: `bit-${event.id}`,
      source: 'bandsintown',
      artist: artistName,
      title: event.title || `${artistName} live`,
      datetime: event.datetime,
      date: event.datetime ? event.datetime.split('T')[0] : null,
      venue: event.venue
        ? {
            name: event.venue.name,
            city: event.venue.city,
            region: event.venue.region,
            country: event.venue.country,
            latitude: event.venue.latitude ? parseFloat(event.venue.latitude) : null,
            longitude: event.venue.longitude ? parseFloat(event.venue.longitude) : null,
          }
        : null,
      lineup: event.lineup || [artistName],
      ticketUrl: event.offers && event.offers.length > 0 ? event.offers[0].url : event.url,
      url: event.url,
      onSale:
        event.offers && event.offers.length > 0 ? event.offers[0].status === 'available' : null,
      description: event.description || '',
    }));
  },
  searchArtist: async function (artistName, config) {
    if (!config.appId) {
      throw new Error('Bandsintown App ID is required');
    }

    const encodedArtist = encodeURIComponent(artistName);
    const url = `https://rest.bandsintown.com/artists/${encodedArtist}?app_id=${encodeURIComponent(config.appId)}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Bandsintown API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      name: data.name,
      imageUrl: data.image_url,
      thumbUrl: data.thumb_url,
      upcomingEventCount: data.upcoming_event_count,
      trackerCount: data.tracker_count,
      url: data.url,
    };
  },
};
