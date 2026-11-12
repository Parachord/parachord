/**
 * The similar-users plugin contract (capabilities.similarUsers; see the
 * Recommendations redesign spec, "Friends: the new capability"): ResolverLoader
 * lists the plugins that declare and implement it, and getSimilarUsers answers
 * [] for one that doesn't (a marketplace install can lag the app), passes the
 * config through, and rejects when the plugin throws so the page keeps what it
 * has instead of caching an outage as "nobody".
 *
 * The plugins' own implementations are tested in lastfm-similar-users.test.js
 * and listenbrainz-recommendations.test.js.
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

const loadAxe = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins', `${id}.axe`), 'utf8'));

describe('ResolverLoader similar users', () => {
  const loaderWith = async (ids) => {
    const loader = new ResolverLoader();
    await loader.loadResolvers(ids.map(loadAxe));
    return loader;
  };

  test('getSimilarUsersResolvers lists only capable resolvers', async () => {
    const loader = await loaderWith(['lastfm', 'listenbrainz', 'amazonmusic', 'youtube']);
    expect(loader.getSimilarUsersResolvers().map(r => r.id).sort()).toEqual(['lastfm', 'listenbrainz']);
    // Declaring the capability is not enough: the function has to be there.
    loader.getResolver('lastfm').getSimilarUsers = undefined;
    expect(loader.getSimilarUsersResolvers().map(r => r.id)).toEqual(['listenbrainz']);
  });

  test('getSimilarUsers answers [] for a resolver without the capability', async () => {
    const loader = await loaderWith(['youtube', 'listenbrainz']);
    expect(await loader.getSimilarUsers('youtube', {})).toEqual([]);
    expect(await loader.getSimilarUsers('nope', {})).toEqual([]);
    // An older plugin: the capability flag without the method.
    loader.getResolver('listenbrainz').getSimilarUsers = undefined;
    expect(await loader.getSimilarUsers('listenbrainz', { username: 'someone' })).toEqual([]);
  });

  test('getSimilarUsers passes the config through and keeps only an array answer', async () => {
    const loader = await loaderWith(['listenbrainz']);
    const r = loader.getResolver('listenbrainz');
    const users = [{ username: 'a', similarity: 0.9 }];
    r.getSimilarUsers = jest.fn(async () => users);
    expect(await loader.getSimilarUsers('listenbrainz', { username: 'me', excludeUsernames: ['x'] })).toEqual(users);
    expect(r.getSimilarUsers).toHaveBeenCalledWith({ username: 'me', excludeUsernames: ['x'] });
    r.getSimilarUsers = async () => ({ users });
    expect(await loader.getSimilarUsers('listenbrainz', {})).toEqual([]);
  });

  test('getSimilarUsers rejects when the plugin throws', async () => {
    const loader = await loaderWith(['listenbrainz']);
    loader.getResolver('listenbrainz').getSimilarUsers = async () => { throw new Error('503'); };
    await expect(loader.getSimilarUsers('listenbrainz', {})).rejects.toThrow('503');
  });
});
