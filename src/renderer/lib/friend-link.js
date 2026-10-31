// src/renderer/lib/friend-link.js — parachord://friend/{id}/{tab?}?period=
// in both directions: reading a deep link into the friend view's tab and
// period, and building the link Copy Link shares for that view.
//
// The two have to agree or a copied link reopens somewhere else. Before
// #1175 the handler ignored ?period= and neither side knew top-albums, so a
// friend's "Top Albums · Last Month" copied as a bare friend link.
//
// The recent tab is the latest plays with no period (the view shows a sort
// dropdown there, not the period one), so a period is neither read nor
// written for it.

const FRIEND_LINK_TABS = {
  'top-tracks': 'topTracks',
  'top-albums': 'topAlbums',
  'top-artists': 'topArtists',
  'recent': 'recent'
};

// Same values as the period dropdown (historyPeriodOptions in app.js).
const HISTORY_PERIODS = ['7day', '1month', '3month', '6month', '12month', 'overall'];

const isTopTab = (tabKey) => tabKey === 'topTracks' || tabKey === 'topAlbums' || tabKey === 'topArtists';

// tabSegment and period are the raw link values. Unknown values are dropped:
// tabKey undefined lets the view pick its default tab, period null keeps the
// view's current period.
function parseFriendLink(tabSegment, period) {
  const tabKey = tabSegment ? FRIEND_LINK_TABS[tabSegment] : undefined;
  return {
    tabKey,
    period: isTopTab(tabKey) && HISTORY_PERIODS.includes(period) ? period : null
  };
}

// The period is written for every top tab, the default included: a link
// without one opens at whatever period the recipient last picked.
function buildFriendLink(id, tabKey, period) {
  const segment = Object.keys(FRIEND_LINK_TABS).find(k => FRIEND_LINK_TABS[k] === tabKey);
  const query = isTopTab(tabKey) && HISTORY_PERIODS.includes(period) ? `?period=${period}` : '';
  return `parachord://friend/${encodeURIComponent(id)}${segment ? '/' + segment : ''}${query}`;
}

module.exports = { parseFriendLink, buildFriendLink, FRIEND_LINK_TABS, HISTORY_PERIODS };
