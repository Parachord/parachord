// The chat's card syntax, {{type|field1|field2|...}}, in one place: the
// whole-line check in renderChatContent and the inline pattern in its
// parseInlineMarkdown read it from here.
//
// A card's body is `[^}]+`, never `.+`: a greedy body ran from the first
// `{{` on a line to the last `}}`, so "{{track|A|X}} and {{track|B|Y}}" drew
// one card with the fields "A|X}} and {{track|B|Y" (#1574). With `[^}]+` a
// line holding two cards fails the whole-line test and goes through the
// inline parser, which draws both and the text between them. Android and
// iOS share a port of this parser and use the same body.

const CARD_TYPES = 'track|artist|album|playlist';
const CARD_BODY = '[^}]+';

// Every card in a piece of text (global: reset lastIndex, or copy it).
const CARD_INLINE_REGEX = new RegExp(`\\{\\{(${CARD_TYPES})\\|(${CARD_BODY})\\}\\}`, 'g');

const WHOLE_LINE_CARD_REGEX = new RegExp(`^\\{\\{(${CARD_TYPES})\\|(${CARD_BODY})\\}\\}$`);

// The card a line consists of, or null when the line is anything else
// (text, or more than one card).
function wholeLineCard(line) {
  const match = typeof line === 'string' ? line.match(WHOLE_LINE_CARD_REGEX) : null;
  if (!match) return null;
  return { type: match[1], parts: match[2].split('|') };
}

module.exports = { CARD_INLINE_REGEX, WHOLE_LINE_CARD_REGEX, wholeLineCard };
