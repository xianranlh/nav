const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("AI image helper routes image-only models to image generation endpoint", () => {
  const AIImage = require("../js/ai-image.js");

  assert.equal(AIImage.isImageGenerationModel("gpt-image-2"), true);
  assert.equal(AIImage.isImageGenerationModel("gpt-image-1"), true);
  assert.equal(AIImage.isImageGenerationModel("gpt-4.1-mini"), false);
  assert.equal(AIImage.imageGenerationEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/images/generations");
  assert.deepEqual(
    AIImage.buildImageGenerationBody({ model: "gpt-image-2", prompt: "画一张熊猫" }),
    { model: "gpt-image-2", prompt: "画一张熊猫", n: 1, size: "1024x1024" },
  );
});

test("AI image helper converts generation responses into renderable assistant content", () => {
  const AIImage = require("../js/ai-image.js");

  const content = AIImage.renderImageGenerationMessage({
    data: [{ b64_json: "abc123", revised_prompt: "cute panda" }],
  }, "画一张熊猫");

  assert.match(content, /已生成图片/);
  assert.match(content, /```json/);
  assert.match(content, /b64_json/);
  assert.match(content, /cute panda/);
});

test("AI image endpoint is wired before the chat module and used by the app", () => {
  const assets = require("../js/static-assets.js");
  const index = fs.readFileSync("index.html", "utf8");
  const ai = fs.readFileSync("js/ai.js", "utf8");
  const aiImage = fs.readFileSync("js/ai-image.js", "utf8");

  assert.ok(assets.scripts.includes("js/ai-image.js"));
  assert.ok(index.indexOf('<script src="js/ai-image.js"></script>') >= 0);
  assert.ok(index.indexOf('<script src="js/ai-image.js"></script>') < index.indexOf('<script src="js/ai.js"></script>'));
  assert.match(ai, /HomepageAIImage/);
  assert.match(ai, /generateImage/);
  assert.match(aiImage, /\/images\/generations/);
});

test("AI image requests go through the same-origin server proxy", () => {
  const ai = fs.readFileSync("js/ai.js", "utf8");
  const server = fs.readFileSync("server/index.js", "utf8");

  assert.match(ai, /function chatViaServer/);
  assert.match(ai, /fetch\("\/api\/ai\/chat"/);
  assert.match(ai, /providerId:\s*provider\.id/);
  assert.doesNotMatch(ai, /fetch\(AIImage\.imageGenerationEndpoint/);

  assert.match(server, /app\.post\("\/api\/ai\/chat", auth, asyncHandler/);
  assert.match(server, /getAiSettings\(\)/);
  assert.match(server, /AIImage\.imageGenerationEndpoint/);
});
