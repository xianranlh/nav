const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('particle scheduler stops for none, reduced motion, hidden pages and open dialogs', () => {
  const frames = new Map();
  const events = {};
  let nextFrame = 0;
  let modal = false;
  let onReducedChange;
  const reduced = { matches: false, addEventListener: (_name, fn) => { onReducedChange = fn; } };
  const ctx = { setTransform() {}, clearRect() {} };
  const canvas = { style: {}, getContext: () => ctx };
  const document = { hidden: false, getElementById: () => canvas, querySelector: () => modal, addEventListener: (name, fn) => { events[name] = fn; } };
  const window = { innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, matchMedia: () => reduced, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync('js/sakura.js', 'utf8'), {
    window, document, performance: { now: () => 0 },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  window.Sakura.init({ particleMode: 'none', count: 0 });
  assert.equal(frames.size, 0);
  window.Sakura.set({ particleMode: 'starlight' });
  assert.equal(frames.size, 1);
  reduced.matches = true; onReducedChange();
  assert.equal(frames.size, 0);
  reduced.matches = false; onReducedChange();
  assert.equal(frames.size, 1);
  modal = true; events['dialog:opened']();
  assert.equal(frames.size, 0);
  document.hidden = true; events.visibilitychange();
  document.hidden = false; events.visibilitychange();
  assert.equal(frames.size, 0);
  modal = false; events.close();
  assert.equal(frames.size, 1);
  window.Sakura.set({ particleMode: 'none' });
  assert.equal(frames.size, 0);
});
