const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const body = (start, endMarker) => {
  const a = src.indexOf(start);
  expect(a).toBeGreaterThan(-1);
  const b = src.indexOf(endMarker, a + start.length);
  return src.slice(a, b);
};

describe('follow a recommended listener', () => {
  test('addFriendCore exists, looks up the exact service, and never touches the modal', () => {
    const core = body('const addFriendCore = async', 'const addFriend = async');
    expect(core).toMatch(/fetchLastfmUserInfo\(username\)/);
    expect(core).toMatch(/fetchListenbrainzUserInfo\(username\)/);
    expect(core).toMatch(/followOnService\(newFriend\)/);
    expect(core).toMatch(/setPinnedFriendIds/);
    expect(core).not.toMatch(/setAddFriendModalOpen|setAddFriendInput|setAddFriendLoading/);
    expect(core).toMatch(/throw new Error/);
  });

  test('addFriend delegates to addFriendCore and keeps its modal behavior', () => {
    const fn = body('const addFriend = async', 'const followRecommendedFriend');
    expect(fn).toMatch(/addFriendCore\(/);
    expect(fn).toMatch(/setAddFriendModalOpen\(false\)/);
    expect(fn).toMatch(/pinned to sidebar/);
  });

  test('the friend header shows Follow only for a non-friend', () => {
    expect(src).toMatch(/!friends\.some\(f => f\.id === currentFriend\.id\) && React\.createElement\('button'/);
  });

  test('Follow calls the core with the person and adopts the returned friend', () => {
    const fn = body('const followRecommendedFriend', '// Remove a friend completely');
    expect(fn).toMatch(/addFriendCore\(\{ service: person\.service, username: person\.username \}\)/);
    expect(fn).toMatch(/setCurrentFriend\(newFriend\)/);
    expect(fn).toMatch(/`Following \$\{newFriend\.displayName\}`/);
    expect(fn).toMatch(/showToast\(error\.message \|\| 'Failed to follow', 'error'\)/);
  });

  test('a restored similar: profile lands on Recommendations', () => {
    expect(src).toMatch(/startsWith\('similar:'\)[\s\S]{0,300}setActiveView\('recommendations'\)/);
  });
});
