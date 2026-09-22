const test = require('node:test');
const assert = require('node:assert/strict');
const { bounds, position, anchor, reduce } = require('../js/pet-companion.js');
test('opening a tool closes interaction without losing a collapsed or resting preference', () => {
  let state = { open: false, collapsed: false, blocked: false, resting: false };
  state = reduce(state, { type: 'rest' });
  state = reduce(state, { type: 'toggle' });
  assert.equal(state.open, true);
  state = reduce(state, { type: 'block', value: true });
  assert.equal(state.open, false);
  assert.equal(reduce(state, { type: 'toggle' }).open, false);
  state = reduce(state, { type: 'collapse' });
  state = reduce(state, { type: 'block', value: false });
  assert.equal(state.collapsed, true);
  assert.equal(state.resting, true);
  state = reduce(state, { type: 'restore' });
  assert.equal(state.open, false);
  assert.equal(state.collapsed, false);
});
test('saved positions round-trip and clamp on smaller screens and extreme drags', () => {
  for (const [w,h,dw,dh] of [[1440,900,210,68],[390,844,196,64],[320,480,236,76],[800,240,210,68]]) {
    const b = bounds(w,h,dw,dh);
    for (const saved of [{xRatio:0,yRatio:0},{xRatio:1,yRatio:1},{xRatio:.25,yRatio:.75},{xRatio:5,yRatio:-2}]) {
      const p = position(saved,b);
      assert.ok(p.x >= 8 && p.x + dw <= w - 8);
      assert.ok(p.bottom >= 8 && p.bottom + dh <= h - 8);
      const round = position(anchor(p.x,p.bottom,b),b);
      assert.ok(Math.abs(round.x-p.x)<.001 && Math.abs(round.bottom-p.bottom)<.001);
    }
    assert.deepEqual(anchor(-999,99999,b),{xRatio:0,yRatio:1});
  }
});
test('remote companion updates refresh local cache without triggering another save or accepting stale settings', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync('js/sakura-remote.js', 'utf8');
  const method = source.slice(source.indexOf('    acceptPetConfig(config) {'), source.indexOf('    _getBrowserLocalItem:'));
  const mem = new Map([['sakura_pet_v3', JSON.stringify({schemaVersion:3,homeScale:'md',updatedAt:100})]]);
  const api = vm.runInNewContext('({' + method + '})', { mem, storageMode:'remote' });
  assert.equal(api.acceptPetConfig({schemaVersion:3,homeScale:'lg',updatedAt:200}),true);
  assert.equal(JSON.parse(mem.get('sakura_pet_v3')).homeScale,'lg');
  assert.equal(api.acceptPetConfig({schemaVersion:3,homeScale:'sm',updatedAt:50}),false);
  assert.equal(JSON.parse(mem.get('sakura_pet_v3')).homeScale,'lg');
  assert.equal(api.acceptPetConfig({schemaVersion:2,updatedAt:300}),false);
});
