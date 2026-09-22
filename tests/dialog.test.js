const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const timers = new Map();
  let timerId = 0;
  const classes = new Set();
  const listeners = new Map();
  const inner = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  const dialog = {
    open: true,
    classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) },
    querySelectorAll: () => [],
    querySelector: () => inner,
    close() { this.open = false; },
    dispatchEvent() {},
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(fs.readFileSync('js/dialog.js', 'utf8'), {
    window, document: { addEventListener() {} },
    CustomEvent: class {},
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  return { manager: window.Dlg, dialog, inner, listeners, timers };
}

test('reopening cancels the old close animation and its fallback timer', () => {
  const { manager, dialog, timers } = setup();
  manager.close(dialog);
  const staleCallback = [...timers.values()][0];
  manager.open(dialog);
  staleCallback();
  assert.equal(dialog.open, true);
  assert.equal(dialog.classList.contains('closing'), false);
  assert.equal(timers.size, 0);
});

test('child animations cannot prematurely close the containing dialog', () => {
  const { manager, dialog, inner, listeners } = setup();
  manager.close(dialog);
  listeners.get('animationend')({ target: {} });
  assert.equal(dialog.open, true);
  listeners.get('animationend')({ target: inner });
  assert.equal(dialog.open, false);
});
