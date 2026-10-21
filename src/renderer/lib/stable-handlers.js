// src/renderer/lib/stable-handlers.js — give a React.memo'd page stable
// function props.
//
// Parachord defines most of its handlers as plain functions in the component
// body, so every render makes new ones. Passing those to a React.memo child
// defeats the memo: the props differ every time. useStableHandlers returns an
// object with the same keys whose functions never change identity and always
// call the latest version (the ref is updated on every render), so a memo'd
// page re-renders only when its data props change.
//
// The key set is fixed by the first call; pass the same keys every render.
// Do not use a wrapper for a function whose RESULT the page renders from
// state the page does not also receive as a prop: the memo would keep the
// old output until some other prop changed.

function useStableHandlers(latest) {
  const ref = React.useRef(latest);
  ref.current = latest;
  const [stable] = React.useState(() => Object.fromEntries(
    Object.keys(latest).map((key) => [key, (...args) => ref.current[key](...args)])
  ));
  return stable;
}

module.exports = { useStableHandlers };
