// src/renderer/components/first-run-tutorial.js: the welcome tour, shown on
// first launch (tutorial_completed) and from Settings › About › Show welcome
// tour. It explains Parachord and asks you to set up nothing (#1493): one
// idea per screen, each with a small picture made of the app's own pieces
// and a line or two. The last screen hands over to Home's getting-started
// layout, where the setup is.
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and memos by value, plain functions through useStableHandlers
// (FIRST_RUN_TUTORIAL_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// window is read only inside handlers.

const Icons = require('./icons');
const { ParachordWordmark, ParachordAppIcon, SERVICE_LOGOS } = require('./brand-logos');
const { Modal } = require('./modal');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { ReasonMark } = require('./reason-badge');
const { FriendAvatar } = require('./friend-avatar');
const { StepMarker, ServiceMark } = require('./home-getting-started');
const { PAGE_COLORS } = require('../lib/page-colors');
const { PAGE_ICONS } = require('../lib/page-icons');
const { stepOnePlugins } = require('../lib/getting-started');

const e = React.createElement;

const FIRST_RUN_TUTORIAL_HANDLERS = [
  'navigateTo',
  'startGettingStarted',
];

// The plug-ins that play here, from the registry: services first, then the
// no-account ones (never a list of names).
const playingPlugins = (loadedResolvers) => {
  const p = stepOnePlugins(loadedResolvers);
  return p.services.slice(0, 3).concat(p.free.slice(0, 1));
};

const PICTURE_STYLE = {
  height: '120px', borderRadius: '12px', backgroundColor: 'var(--bg-secondary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '24px',
};

const pageMark = (page) => {
  const Icon = Icons[PAGE_ICONS[page]] || Icons.Music;
  return e('span', {
    key: page,
    style: {
      width: '44px', height: '44px', borderRadius: '12px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--card-bg)', color: PAGE_COLORS[page] ? PAGE_COLORS[page].color : 'var(--accent-primary)', boxShadow: 'var(--card-shadow)',
    },
  }, e(Icon, { size: 22 }));
};

// One entry per screen: its title, its line, `needs` (the caveat: what the
// feature needs before it works, an honest expectation, never a question;
// shown in italics), and its picture. A screen describes what
// a feature does rather than naming it: a new person doesn't know the
// pages' names yet.
const TOUR_SCREENS = [
  {
    id: 'welcome',
    title: 'One player for all your music',
    body: 'Spotify, Apple Music, Bandcamp, your own files: Parachord finds a song wherever you have it and plays it here.',
    picture: ({ loadedResolvers }) => e(React.Fragment, null,
      playingPlugins(loadedResolvers).map((r) => e(ServiceMark, { key: r.id, resolver: r })),
      e('span', {
        style: {
          width: '36px', height: '36px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)',
        },
      }, e(Icons.Folder, { size: 18 })),
      e(Icons.ArrowRight, { size: 20, className: 'text-ink-tertiary' }),
      e(ParachordAppIcon, { size: 48 })),
  },
  {
    id: 'collection',
    title: 'Your collection and playlists, everywhere',
    body: 'Import playlists and liked songs from any service, and keep a playlist in sync across the services you use.',
    picture: ({ loadedResolvers }) => e('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' } },
      e('span', { className: 'text-ink-primary', style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600 } },
        e(Icons.ListMusic, { size: 18 }), 'Road trip'),
      e('div', { style: { display: 'flex', gap: '6px' } },
        stepOnePlugins(loadedResolvers).services.slice(0, 3).map((r) => e(Badge, { key: r.id, color: r.color || undefined }, r.name)))),
  },
  {
    id: 'discover',
    title: 'Find new music',
    body: 'New releases from artists you follow, the albums critics love most, what’s most played right now, and picks made from your listening.',
    needs: 'New releases and picks fill in once you connect a service or bring in your music.',
    picture: () => ['new-releases', 'critics-picks', 'discover', 'recommendations'].map(pageMark),
  },
  {
    id: 'concerts',
    title: 'Never miss a show',
    body: 'See upcoming concerts near you from the artists you listen to, with tickets a click away. When an artist you’re playing is on tour near you, a dot appears beside their name in the player; click it for their dates.',
    needs: 'Works once you add a tickets plug-in and set your location.',
    // The playbar's now-playing lines in small, on the player's dark surface,
    // with its on-tour dot (playbar.js) in the Concerts colour.
    picture: () => e('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', borderRadius: '12px',
        backgroundColor: 'var(--surface-dark)', boxShadow: 'var(--card-shadow)',
      },
    },
      e('span', { style: { width: '44px', height: '44px', borderRadius: '6px', backgroundColor: 'var(--surface-dark-placeholder)', flexShrink: 0 } }),
      e('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        e('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--on-dark-primary)' } }, 'Now playing'),
        e('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--on-dark-secondary)' } },
          'The artist',
          e('span', { style: { width: '7px', height: '7px', borderRadius: '9999px', backgroundColor: PAGE_COLORS.concerts.color } }))),
      e('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '8px', fontSize: '12px', color: 'var(--on-dark-secondary)' },
      }, e(Icons.Ticket, { size: 14 }), 'On tour near you')),
  },
  {
    // What the chat can do comes from its DJ tools (tools/dj-tools.js): play,
    // search, queue, shuffle, make and edit playlists, block a pick.
    id: 'shuffleupagus',
    title: 'Chat with your AI DJ',
    body: 'Its name is Shuffleupagus. Ask for a mood or a moment, and it plays it. Ask it to queue more like what’s on, make a playlist or add to one, skip or shuffle, steer your recommendations, or answer a question about the music.',
    needs: 'Works once you add an AI plug-in, from an online service or one that runs on your computer.',
    // A chat exchange in small: your ask, and the DJ answering with its mark.
    picture: () => e('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', width: '78%' } },
      e('span', {
        style: { alignSelf: 'flex-end', padding: '8px 12px', borderRadius: '12px', fontSize: '13px', backgroundColor: 'var(--accent-fill)', color: 'var(--on-accent)' },
      }, 'Something for a rainy Sunday'),
      e('span', {
        className: 'text-ink-primary',
        style: { alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '12px', fontSize: '13px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' },
      }, e(ReasonMark, { size: 22 }), 'Slow and warm: playing 20 tracks')),
  },
  {
    id: 'friends',
    title: 'Friends',
    body: 'See what your friends are playing, and listen along.',
    needs: 'Works once you connect Last.fm or ListenBrainz.',
    picture: () => e(React.Fragment, null,
      e(FriendAvatar, { name: 'Alex', size: 'md' }),
      e(FriendAvatar, { name: 'Sam', size: 'md' }),
      e('span', { className: 'text-ink-secondary', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' } },
        e(Icons.Headphones, { size: 16 }), 'Listening along')),
  },
  {
    // Achordion (achordion.xyz) is the web companion: Copy link on a song,
    // album, artist or playlist makes an Achordion link (app.js), which
    // anyone can open and play on the service they use.
    id: 'achordion',
    title: 'Share music with anyone',
    body: 'Achordion is Parachord’s companion on the web, for finding music and sharing what you listen to. Copy a link to any song, album, artist or playlist, and it opens on Achordion, where anyone can listen, whatever service they use. They don’t need Parachord.',
    picture: ({ loadedResolvers }) => e(React.Fragment, null,
      SERVICE_LOGOS.achordion && React.cloneElement(SERVICE_LOGOS.achordion, { className: undefined, style: { width: '48px', height: '48px' } }),
      e(Icons.Link, { size: 20, className: 'text-ink-tertiary' }),
      stepOnePlugins(loadedResolvers).services.slice(0, 3).map((r) => e(ServiceMark, { key: r.id, resolver: r }))),
  },
  {
    id: 'setup',
    title: 'Let’s get you set up',
    body: 'Three steps on Home: connect where you listen, bring in your music, and start listening.',
    picture: () => [0, 1, 2].map((i) => e(StepMarker, { key: i, index: i, done: false, current: i === 0 })),
  },
];

const FirstRunTutorial = React.memo(function FirstRunTutorial(props) {
  const {
    firstRunTutorial,
    loadedResolvers,
    navigateTo,
    setFirstRunTutorial,
    startGettingStarted,
  } = props;
  const index = Math.max(0, TOUR_SCREENS.findIndex((s) => s.id === firstRunTutorial.step));
  const screen = TOUR_SCREENS[index];
  const last = index === TOUR_SCREENS.length - 1;
  const go = (i) => setFirstRunTutorial((prev) => ({ ...prev, step: TOUR_SCREENS[i].id }));
  const close = async (setup) => {
    await window.electron.store.set('tutorial_completed', true);
    setFirstRunTutorial((prev) => ({ ...prev, open: false, step: 'welcome' }));
    if (setup) startGettingStarted();
    else navigateTo('home');
  };

  return React.createElement(Modal, {
    bare: true, label: 'Welcome to Parachord', scrimClassName: 'z-50', dismissible: false,
    panelProps: {
      className: 'relative w-full max-w-xl mx-4 overflow-hidden',
      style: {
        // Never taller than the window: the body scrolls instead.
        maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
        backgroundColor: 'var(--card-bg)', borderRadius: '16px', boxShadow: 'var(--shadow-dialog)',
      },
    },
  },
    e('div', { style: { height: '4px', backgroundColor: 'var(--accent-primary)' } }),
    // One height for every screen, so Back and Next stay put as you step.
    e('div', { style: { padding: '32px 32px 24px', minHeight: '360px' } },
      index === 0 && e('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '20px' } },
        e(ParachordWordmark, { fill: 'var(--text-primary)', height: 40 })),
      e('div', { 'aria-hidden': 'true', style: PICTURE_STYLE }, screen.picture({ loadedResolvers })),
      e('h2', { className: 'text-ink-primary', style: { fontSize: '20px', fontWeight: 600, margin: '0 0 8px' } }, screen.title),
      e('p', { className: 'text-ink-secondary', style: { fontSize: '14px', lineHeight: 1.6, margin: 0 } }, screen.body),
      // The caveat (what a feature needs before it works), set apart in italics.
      screen.needs && e('p', { className: 'text-ink-tertiary', style: { fontSize: '13px', lineHeight: 1.5, margin: '8px 0 0', fontStyle: 'italic' } }, screen.needs)),
    e('div', {
      style: { padding: '16px 32px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' },
    },
      last
        ? e(Button, { variant: 'text', size: 'sm', onClick: () => close(false) }, 'Not now')
        : e(Button, { variant: 'text', size: 'sm', onClick: () => close(false) }, 'Skip tour'),
      // Where you are in the tour: dots, and the same in words for a screen reader.
      e('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        e('span', { className: 'sr-only' }, `Screen ${index + 1} of ${TOUR_SCREENS.length}`),
        TOUR_SCREENS.map((s, i) => e('span', {
          key: s.id, 'aria-hidden': 'true',
          style: { width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: i === index ? 'var(--accent-primary)' : 'var(--border-default)' },
        }))),
      e('div', { style: { display: 'flex', gap: '8px' } },
        index > 0 && e(Button, { variant: 'secondary', onClick: () => go(index - 1) }, 'Back'),
        last
          ? e(Button, { variant: 'primary', onClick: () => close(true) }, 'Set up on Home')
          : e(Button, { variant: 'primary', onClick: () => go(index + 1) }, 'Next'))));
});

module.exports = { FirstRunTutorial, FIRST_RUN_TUTORIAL_HANDLERS, TOUR_SCREENS };
