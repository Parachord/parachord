// Shared vectors for the artist-credit rule, used by
// tests/resolver/confidence-scoring.test.js and, for the plugins that filter their
// own results, tests/resolver/plugin-credit-match.test.js. parachord-mobile's
// scoreConfidence must return the same score for every row (cross-platform
// invariant), so keep this table in the shape the Kotlin test copies: target
// artist, target title, result artist, result title, expected score.
const ARTIST_CREDIT_VECTORS = [
  // Live console, 2026-10-30: correct recordings scored 0.50.
  ['Erykah Badu and The Alchemist', 'Breezy', 'Erykah Badu & The Alchemist', 'Breezy', 0.95],
  ['Erykah Badu and The Alchemist', 'Breezy', 'Erykah Badu, The Alchemist', 'Breezy', 0.95],
  ['Shakey Graves feat. Sierra Ferrell', 'Ready or Not', 'Shakey Graves, Sierra Ferrell', 'Ready or Not (feat. Sierra Ferrell)', 0.95],

  // Every join style against every other.
  ['Artist One feat. Artist Two', 'Song', 'Artist One, Artist Two', 'Song', 0.95],
  ['Artist One feat Artist Two', 'Song', 'Artist One & Artist Two', 'Song', 0.95],
  ['Artist One ft. Artist Two', 'Song', 'Artist One and Artist Two', 'Song', 0.95],
  ['Artist One ft Artist Two', 'Song', 'Artist One x Artist Two', 'Song', 0.95],
  ['Artist One featuring Artist Two', 'Song', 'Artist One, Artist Two', 'Song', 0.95],
  ['Artist One (feat. Artist Two)', 'Song', 'Artist One and Artist Two', 'Song', 0.95],
  ['Artist One [ft. Artist Two]', 'Song', 'Artist One & Artist Two', 'Song', 0.95],
  ['Artist One X Artist Two', 'Song', 'Artist One, Artist Two', 'Song', 0.95],
  ['Artist One&Artist Two', 'Song', 'Artist One and Artist Two', 'Song', 0.95],
  ['Artist One, Artist Two, and Artist Three', 'Song', 'Artist One & Artist Two x Artist Three', 'Song', 0.95],

  // A band name with a join in it is the same band whichever way it's written.
  ['Simon and Garfunkel', 'The Boxer', 'Simon & Garfunkel', 'The Boxer', 0.95],
  ['Earth, Wind and Fire', 'September', 'Earth, Wind & Fire', 'September', 0.95],

  // Credits are compared as a set: another order, or one side crediting more
  // names, is the same rule the plain containment check already applies to a
  // single name.
  ['Artist Two and Artist One', 'Song', 'Artist One, Artist Two', 'Song', 0.95],
  ['Artist One and Artist Two', 'Song', 'Artist One, Artist Two, Artist Three', 'Song', 0.95],
  ['Artist One feat. Artist Two', 'Song', 'Artist One', 'Song', 0.95],
  ['Artist One', 'Song', 'Artist One feat. Artist Two', 'Song', 0.95],

  // Accents and full-width punctuation fold before the split, as in normalizeStr.
  ['Björk and José González', 'Song', 'Bjork, Jose Gonzalez', 'Song', 0.95],
  ['宇多田ヒカル＆椎名林檎', '二時間だけのバカンス', '椎名林檎, 宇多田ヒカル', '二時間だけのバカンス', 0.95],

  // A trailing credit in the title may be written differently on each side.
  ['Artist One', 'Song (feat. Artist Two)', 'Artist One', 'Song (ft. Artist Two)', 0.95],
  ['Artist One', 'Song [featuring Artist Two]', 'Artist One', 'Song (feat. Artist Two)', 0.95],
  ['Artist One', 'Song (feat. Artist Two and Artist Three)', 'Artist One', 'Song (feat. Artist Two & Artist Three)', 0.95],
  ['Artist One', 'Song', 'Artist One', 'Song (feat. Artist Two)', 0.95],

  // Negative: a different artist, whatever words it shares, is still wrong.
  ['The Beatles', 'Yesterday', 'Boyz II Men', 'Yesterday', 0.5],
  ['The Beatles', 'Yesterday', 'The Rolling Stones', 'Yesterday', 0.5],
  ['Erykah Badu & The Alchemist', 'Breezy', 'The Alchemist Project', 'Breezy', 0.5],
  ['Paul Simon', 'The Boxer', 'Simon & Garfunkel', 'The Boxer', 0.5],

  // Negative: sharing one credited name out of two is not the same credit.
  ['Simon & Garfunkel', 'The Boxer', 'Simon & Schuster', 'The Boxer', 0.5],
  ['Erykah Badu and The Alchemist', 'Breezy', 'Erykah Badu & Madlib', 'Breezy', 0.5],
  ['Shakey Graves feat. Sierra Ferrell', 'Ready or Not', 'Shakey Graves, Orville Peck', 'Ready or Not', 0.5],

  // Negative: a join word that is part of a name doesn't split it.
  ['Little Feat', 'Dixie Chicken', 'Little & Large', 'Dixie Chicken', 0.5],
  ['Malcolm X', 'Song', 'Malcolm & Marie', 'Song', 0.5],
  ['X Ambassadors', 'Song', 'Ambassadors & Friends', 'Song', 0.5],
  ['And One', 'Song', 'One & Only', 'Song', 0.5],
  ['Max Richter', 'Song', 'Ma & Richter', 'Song', 0.5],
  ['Sand Castle', 'Song', 'S & Castle', 'Song', 0.5],

  // Negative: both axes are still required.
  ['Erykah Badu and The Alchemist', 'Breezy', 'Erykah Badu & The Alchemist', 'Something Else', 0.5],

  // Negative: a title credit only ever comes off the end of a title, and the
  // rest of the title then has to match exactly, not by containment.
  ['Artist One', 'Hello (feat. Artist Two)', 'Artist One', 'Hello Goodbye', 0.5],
  ['Artist One', 'Song (feat. Artist Two)', 'Artist One', 'Song - Remastered', 0.5],
  ['Artist One', 'Song (feat. Artist Two)', 'Artist One', 'Song (Acoustic)', 0.5],
  ['Artist One', 'Song (feature film)', 'Artist One', 'Song (ft. Artist Two)', 0.5],
  ['Artist One', '(feat. Artist Two)', 'Artist One', '(ft. Artist Two)', 0.5],
];

module.exports = { ARTIST_CREDIT_VECTORS };
