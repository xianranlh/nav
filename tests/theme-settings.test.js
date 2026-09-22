const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Theme = require('../js/homepage-theme.js');
const source = fs.readFileSync(require.resolve('../js/app.js'), 'utf8');

function fixture(accent = '#ff8fab') {
  const handlers = {}, values = {}, css = {};
  let saved;
  const context = {
    Theme, s: { visualTheme: 'sakura', accent },
    $: id => ({ addEventListener: (event, fn) => { handlers[id + ':' + event] = fn; } }),
    setV: (id, value) => { values[id] = value; },
    applyVisualTheme() {}, applyHeroMode() {}, syncSakuraParticles() {},
    CustomEvent: function () {},
    document: { documentElement: { dataset: {}, style: { setProperty: (key, value) => { css[key] = value; } } }, querySelector: () => null, dispatchEvent() {} },
  };
  context.Store = { settings: context.s, saveSettings() { saved = JSON.parse(JSON.stringify(context.s)); } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function hexToRgb('), source.indexOf('  function particleModeFromVisualTheme(')), context);
  vm.runInContext(source.slice(source.indexOf('    $("#set-visual-theme").addEventListener'), source.indexOf('    $("#set-fontsize").addEventListener')), context);
  return { context, css, values, saved: () => saved, change: id => handlers['#set-visual-theme:change']({ target: { value: id } }), color: value => handlers['#set-accent:input']({ target: { value } }), reset: () => handlers['#set-accent-reset:click']() };
}

test('theme changes persist the new default accent and apply it', () => {
  const f = fixture();
  f.change('paper');
  assert.equal(f.saved().accent, '#b07c4f');
  assert.equal(f.saved().visualTheme, 'paper');
  assert.equal(f.css['--accent'], '#b07c4f');
  assert.equal(f.values['#set-accent'], '#b07c4f');
  f.change('q-anime');
  assert.equal(f.saved().accent, '#c4a8e8');
});

test('custom and saved blue accents survive switching; reset uses current theme', () => {
  for (const accent of ['#123456', '#476b96']) {
    const f = fixture();
    f.color(accent);
    f.change('paper');
    assert.equal(f.saved().accent, accent);
    assert.equal(f.css['--accent'], accent);
    f.reset();
    assert.equal(f.saved().accent, '#b07c4f');
    assert.equal(f.css['--accent'], '#b07c4f');
    Object.assign(f.context.Store.settings, f.saved());
    f.context.applyStyle();
    assert.equal(f.css['--accent'], '#b07c4f');
  }
});
