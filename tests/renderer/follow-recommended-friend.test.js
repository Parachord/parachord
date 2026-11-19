const fs = require('fs');
const path = require('path');
const src = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;

const body = (start, endMarker) => {
  const a = src.indexOf(start);
  expect(a).toBeGreaterThan(-1);
  const b = src.indexOf(endMarker, a + start.length);
  return src.slice(a, b);
};

describe('follow a recommended listener', () => {
  test('addFriendCore exists, looks up the exact service, and never touches the modal', () => {
    const core = body('const addFriendCore = async', 'const addFriend = async');
    // Looked up on exactly that service's plug-in (findUser, #1539 step 5).
    expect(core).toMatch(/const person = found \|\| await findFriendOn\(service, username\);/);
    expect(core).toMatch(/followOnService\(newFriend\)/);
    expect(core).toMatch(/setPinnedFriendIds/);
    expect(core).not.toMatch(/setAddFriendModalOpen|setAddFriendInput|setAddFriendLoading/);
    expect(core).toMatch(/throw userError\(/);
  });

  test('addFriendCore refuses a service that is not a friend service, before any lookup', () => {
    // A third similarUsers plugin must never make Follow look the same name
    // up somewhere else. A friend service is a plug-in with
    // capabilities.friends (#1539 step 5).
    const core = body('const addFriendCore = async', 'const addFriend = async');
    const guard = core.search(/if \(!isFriendService\(service\)\) \{\s*throw userError\(/);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(core.indexOf('findFriendOn(service, username)'));
    expect(core).toMatch(/const finalService = service;/);
    expect(src).toContain("const isFriendService = (id) => friendProvidersFor().some(r => r.id === id);");
    expect(src).toContain("const friendProvidersFor = () => similarProvidersFor('friends');");
  });

  test('only friend-service similar-users providers are asked (the Friends row input)', () => {
    const fn = body('const similarUsersProviders = () => {', 'const recommendationExclusions');
    expect(fn).toMatch(/\.filter\(r => isFriendService\(r\.id\)\)/);
  });

  test('addFriend (the browser extension\'s link) delegates to addFriendCore; the dialog closes itself', () => {
    const fn = body('const addFriend = async', 'const followRecommendedFriend');
    expect(fn).toMatch(/addFriendCore\(/);
    // The Add a friend dialog (components/add-friend-dialog.js) adds through
    // addFriendCore and closes on success; addFriend no longer drives it.
    expect(fn).not.toMatch(/setAddFriendModalOpen/);
    const dialog = require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/components/add-friend-dialog.js'), 'utf8');
    expect(dialog).toMatch(/await onAdd\(service, name\);\s*onClose\(\);/);
    // The friend sliding into the sidebar says it (addFriendCore), not a toast.
    expect(fn).not.toMatch(/pinned to sidebar/);
  });

  test('the friend header shows Follow only for a non-friend', () => {
    expect(src).toMatch(/!friends\.some\(f => f\.id === currentFriend\.id\) && React\.createElement\(Button, \{ variant: 'primary'/);
  });

  test('Follow calls the core with the person and adopts the returned friend', () => {
    const fn = body('const followRecommendedFriend', '// Remove a friend completely');
    expect(fn).toMatch(/addFriendCore\(\{ service: person\.service, username: person\.username \}\)/);
    expect(fn).toMatch(/setCurrentFriend\(newFriend\)/);
    // The sidebar slide-in says they were added; no toast repeats it.
    expect(fn).not.toMatch(/`Following /);
    expect(fn).toMatch(/showToast\(errorText\(error, 'Couldn’t follow them\. Try again\.'\), 'error'\)/);
  });

  test('a restored similar: profile lands on Recommendations', () => {
    expect(src).toMatch(/startsWith\('similar:'\)[\s\S]{0,300}setActiveView\('recommendations'\)/);
  });
});
