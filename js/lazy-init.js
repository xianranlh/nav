/* Small run-once initializer for non-critical UI modules. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HomepageLazyInit = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createLazyInitializer() {
    const initialized = new Set();
    const results = new Map();
    return {
      has: (id) => initialized.has(id),
      list: () => [...initialized],
      markInitialized(id) {
        initialized.add(id);
        return true;
      },
      reset(id) {
        initialized.delete(id);
        results.delete(id);
      },
      runOnce(id, fn) {
        if (initialized.has(id)) return results.get(id);
        initialized.add(id);
        const result = typeof fn === "function" ? fn() : undefined;
        results.set(id, result);
        return result;
      },
    };
  }

  return {
    createLazyInitializer,
  };
});
