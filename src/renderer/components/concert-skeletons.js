// src/renderer/components/concert-skeletons.js: the loading stand-ins for a
// list of concerts. The Concerts page and an artist's On tour tab use them.
//
// Each matches its page's real row, so the list replaces it without a jump:
//   photo: true   the Concerts page's row: a 100px date column, the artist's
//                 100×100 photo full-bleed, the details, and a 100px Tickets
//                 column
//   photo: false  an artist's On tour row: padded, a 56px date column, the
//                 details and Tickets
// Rows sit under a month label, as the real list groups them. Before
// 2026-11-15 the Concerts page's skeleton had no photo and the On tour tab
// showed a lone spinner under "0 upcoming concerts".
// Props-driven; loads under plain Node.

const e = React.createElement;

const BAR = 'bg-surface-placeholder rounded';
const ROW = 'flex items-center rounded-xl border bg-surface-card border-line-light';

function DateBars() {
  return e(React.Fragment, null,
    e('div', { className: `w-8 h-3 ${BAR} mb-1` }),
    e('div', { className: `w-7 h-6 ${BAR} mb-1` }),
    e('div', { className: `w-8 h-3 ${BAR}` }));
}

function DetailBars() {
  return e(React.Fragment, null,
    e('div', { className: `w-48 h-4 ${BAR} mb-2` }),
    e('div', { className: `w-32 h-3 ${BAR} mb-1` }),
    e('div', { className: `w-24 h-3 ${BAR}` }));
}

const TICKETS_BAR = `w-20 h-9 ${BAR} rounded-lg`;

function ConcertListRowSkeleton({ photo = false, index = 0 }) {
  const pulse = { animation: 'pulse 1.5s ease-in-out infinite', animationDelay: `${index * 100}ms` };
  if (photo) {
    return e('div', { className: ROW, style: pulse, 'aria-hidden': 'true' },
      e('div', { className: 'flex flex-col items-center justify-center flex-shrink-0 px-4', style: { minWidth: '100px' } }, e(DateBars)),
      e('div', { className: `flex-shrink-0 ${BAR}`, style: { width: '100px', height: '100px', borderRadius: 0 } }),
      e('div', { className: 'flex-1 min-w-0 px-4 py-3' }, e(DetailBars)),
      e('div', { className: 'flex-shrink-0 flex items-center justify-center mr-4', style: { width: '100px' } },
        e('div', { className: TICKETS_BAR })));
  }
  return e('div', { className: `${ROW} gap-4 p-4`, style: pulse, 'aria-hidden': 'true' },
    e('div', { className: 'flex flex-col items-center', style: { minWidth: '56px' } }, e(DateBars)),
    e('div', { className: 'flex-1 min-w-0' }, e(DetailBars)),
    e('div', { className: `flex-shrink-0 ${TICKETS_BAR}` }));
}

// A month label and `count` rows.
function ConcertListSkeleton({ count = 6, photo = false }) {
  return e('div', { role: 'status', 'aria-label': 'Loading concerts', className: 'mb-8' },
    e('div', { className: `w-28 h-4 ${BAR} mb-3 mx-1` }),
    e('div', { className: 'space-y-3' },
      Array.from({ length: count }, (_, i) => e(ConcertListRowSkeleton, { key: i, photo, index: i }))));
}

module.exports = { ConcertListSkeleton, ConcertListRowSkeleton };
