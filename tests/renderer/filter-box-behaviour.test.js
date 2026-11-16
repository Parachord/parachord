/**
 * @jest-environment jsdom
 *
 * The shared FilterBox behaves like the twelve copies it replaced: typing
 * hands the page the text (the old inline onChange was
 * `(e) => setX(e.target.value)`), an empty box closes on blur, ✕ empties
 * and closes it, and Escape does too without reaching a dialog around it.
 */
global.React = global.React || require('react');
global.ReactDOM = global.ReactDOM || require('react-dom');
const React = global.React;
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const { FilterBox } = require('../../src/renderer/components/filter-box');

global.IS_REACT_ACT_ENVIRONMENT = true;

// A page's state: the text and whether the box is open.
function Harness({ log, initialOpen = false, initialValue = '' }) {
  const [value, setValue] = React.useState(initialValue);
  const [open, setOpen] = React.useState(initialOpen);
  log.value = value; log.open = open;
  return React.createElement(FilterBox, { value, onChange: setValue, open, onOpenChange: setOpen });
}

const mount = (props) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const log = {};
  act(() => root.render(React.createElement(Harness, Object.assign({ log }, props))));
  return { host, log, done: () => { act(() => root.unmount()); host.remove(); } };
};

const type = (input, text) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
};

test('the search button opens it; typing hands the page the text', () => {
  const { host, log, done } = mount({});
  act(() => host.querySelector('button[aria-label="Filter"]').click());
  expect(log.open).toBe(true);
  const input = host.querySelector('input');
  type(input, 'radio');
  expect(log.value).toBe('radio');
  done();
});

test('✕ empties and closes it', () => {
  const { host, log, done } = mount({ initialOpen: true, initialValue: 'radio' });
  act(() => host.querySelector('button[aria-label="Clear filter"]').click());
  expect(log.value).toBe('');
  expect(log.open).toBe(false);
  done();
});

test('Escape empties and closes it, and is marked handled for a dialog around it', () => {
  const { host, log, done } = mount({ initialOpen: true, initialValue: 'radio' });
  const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  act(() => { host.querySelector('input').dispatchEvent(ev); });
  expect(ev.defaultPrevented).toBe(true);
  expect(log.value).toBe('');
  expect(log.open).toBe(false);
  done();
});

test('an empty box closes on blur; one with text stays open', () => {
  const a = mount({ initialOpen: true });
  act(() => { a.host.querySelector('input').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  expect(a.log.open).toBe(false);
  a.done();
  const b = mount({ initialOpen: true, initialValue: 'radio' });
  act(() => { b.host.querySelector('input').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  expect(b.log.open).toBe(true);
  b.done();
});
