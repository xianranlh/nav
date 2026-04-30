# Second Wave Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the next optimization wave: controller decomposition boundaries, media cleanup, stronger smoke coverage, AI action preview/rollback, command palette, snapshot enhancements, plugin lifecycle, lazy initialization, accessibility helpers, and docs.

**Architecture:** Add focused helper modules under `js/`, keep UI wiring in `js/app.js` minimal, and expose server-side cleanup/versioning endpoints from `server/index.js` backed by `server/database.js`. Every item gets regression coverage in a single second-wave test file plus existing full test verification.

**Tech Stack:** Plain browser JavaScript modules using the repo's UMD pattern, Node `node:test`, Express, SQLite via `better-sqlite3`, and the existing static asset manifest.

---

### Task 1: Regression Contract

**Files:**
- Create: `tests/second-wave-optimizations.test.js`

- [ ] Write tests for each requested optimization area.
- [ ] Run `node --test tests/second-wave-optimizations.test.js` and verify it fails on missing modules/endpoints/docs.

### Task 2: Client Architecture Modules

**Files:**
- Create: `js/app-modules.js`
- Create: `js/ai-actions.js`
- Create: `js/command-palette.js`
- Create: `js/data-versioning.js`
- Create: `js/lazy-init.js`
- Create: `js/a11y.js`
- Modify: `js/feature-registry.js`
- Modify: `js/static-assets.js`
- Modify: `index.html`
- Modify: `js/app.js`

- [ ] Implement small focused helpers and register them in the static asset manifest.
- [ ] Wire command palette, lazy init helper, a11y helper, and AI action preview references into the app shell.

### Task 3: Media Cleanup And Snapshot Versioning

**Files:**
- Create: `js/media-cleanup.js`
- Modify: `server/database.js`
- Modify: `server/index.js`

- [ ] Implement media reference scanning and orphan classification helpers.
- [ ] Add `/api/media/orphans` and `/api/media/orphans/delete`.
- [ ] Add snapshot compare and category restore helpers.

### Task 4: Smoke And Documentation

**Files:**
- Modify: `scripts/smoke-browser.js`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/STORAGE.md`
- Create: `docs/DEPLOYMENT.md`
- Create: `docs/FEATURES.md`
- Create: `docs/TESTING.md`
- Modify: `docs/OPTIMIZATION-BACKLOG.md`

- [ ] Expand smoke checks to cover the new app shell IDs and server API readiness.
- [ ] Split long-term documentation into focused docs.
- [ ] Mark completed items in the optimization backlog.

### Task 5: Verification

- [ ] Run `node --test tests/second-wave-optimizations.test.js`.
- [ ] Run `npm run check`.
- [ ] Run `npm test`.
- [ ] Run `git diff --check`.
- [ ] Run `npm run smoke:browser`.
