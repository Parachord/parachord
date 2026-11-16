// src/renderer/components/friend-avatar.js: a friend's hexagon avatar.
//
// Their photo, or their initial in white on the avatar gradient
// (--avatar-gradient, index.html): the sidebar's look. A photo that fails
// to load falls back to the initial too, never a broken image.
//
// The profile page drew its own copy, the initial on a translucent white
// that all but vanished on its hero (2026-11-16), and the sidebar another.
//
// Props: name (the initial comes from it), avatarUrl, size ('sm' 32px, the
// sidebar | 'md' 40px, a collapsed hero | 'lg' 96px, a profile hero),
// className, style (placement: margins).
// Props-driven; hooks are qualified; loads under plain Node.

const HEXAGON = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
const SIZES = {
  sm: { box: '32px', font: '12px' },
  md: { box: '40px', font: '16px' },
  lg: { box: '96px', font: '28px' },
};

function FriendAvatar({ name, avatarUrl, size = 'sm', className, style }) {
  const e = React.createElement;
  const [brokenUrl, setBrokenUrl] = React.useState(null);
  const s = SIZES[size] || SIZES.sm;
  const showPhoto = !!avatarUrl && brokenUrl !== avatarUrl;
  return e('div', {
    className: ['flex-shrink-0 overflow-hidden', className].filter(Boolean).join(' '),
    style: Object.assign({ width: s.box, height: s.box, clipPath: HEXAGON }, style),
  },
  showPhoto
    ? e('img', { src: avatarUrl, alt: '', className: 'w-full h-full object-cover', onError: () => setBrokenUrl(avatarUrl) })
    : e('div', {
      'aria-hidden': 'true',
      className: 'w-full h-full flex items-center justify-center',
      style: { background: 'var(--avatar-gradient)', color: 'var(--on-accent)', fontSize: s.font, fontWeight: 500 },
    }, (name || '?').charAt(0).toUpperCase()));
}

module.exports = { FriendAvatar, FRIEND_HEXAGON: HEXAGON };
