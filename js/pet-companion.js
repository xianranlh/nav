/* Pure companion state and viewport geometry, shared by UI and regression tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetCompanion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number.isFinite(+n) ? +n : min));
  function bounds(width, height, dockWidth, dockHeight) {
    return { left: 8, right: Math.max(8, width - dockWidth - 8), bottom: Math.min(80, Math.max(8, height - dockHeight - 8)), top: Math.max(8, height - dockHeight - 16) };
  }
  function position(anchor, b) {
    return { x: b.left + (b.right - b.left) * clamp(anchor?.xRatio ?? 1, 0, 1), bottom: b.bottom + Math.max(0, b.top - b.bottom) * clamp(anchor?.yRatio ?? 0, 0, 1) };
  }
  function anchor(x, bottom, b) {
    return { xRatio: clamp((x - b.left) / Math.max(1, b.right - b.left), 0, 1), yRatio: clamp((bottom - b.bottom) / Math.max(1, b.top - b.bottom), 0, 1) };
  }
  function reduce(state, action) {
    switch (action.type) {
      case 'toggle': return state.blocked || state.collapsed ? state : { ...state, open: !state.open };
      case 'close': return { ...state, open: false };
      case 'collapse': return { ...state, open: false, collapsed: true };
      case 'restore': return { ...state, collapsed: false };
      case 'block': return { ...state, blocked: !!action.value, open: action.value ? false : state.open };
      case 'rest': return { ...state, resting: !state.resting };
      default: return state;
    }
  }
  return { bounds, position, anchor, reduce };
});
