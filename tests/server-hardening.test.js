const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("server has centralized JSON error handling for API and upload failures", () => {
  const server = fs.readFileSync("server/index.js", "utf8");

  assert.match(server, /function createHttpError/);
  assert.match(server, /function asyncHandler/);
  assert.match(server, /function jsonErrorHandler/);
  assert.match(server, /app\.use\(jsonErrorHandler\)/);
  assert.match(server, /LIMIT_FILE_SIZE/);
  assert.match(server, /status\(413\)/);
});

test("server validates uploaded media by category before accepting files", () => {
  const server = fs.readFileSync("server/index.js", "utf8");

  assert.match(server, /const MEDIA_RULES = Object\.freeze/);
  assert.match(server, /function validateUploadedMedia/);
  assert.match(server, /function cleanupUploadedFile/);
  assert.match(server, /makeUploader\("bg", MEDIA_RULES\.bg\)/);
  assert.match(server, /makeUploader\("music", MEDIA_RULES\.music\)/);
  assert.match(server, /makeUploader\("lrc", MEDIA_RULES\.lrc\)/);
  assert.match(server, /validateUploadedMedia\(req\.file, category\)/);
  assert.match(server, /415/);
});
