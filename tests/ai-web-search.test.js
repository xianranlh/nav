const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("AI web search helper builds Responses API search requests", () => {
  const AIWebSearch = require("../js/ai-web-search.js");
  const body = AIWebSearch.buildResponsesSearchBody({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: "你会给出来源。" },
      { role: "user", content: "今天有什么科技新闻？" },
    ],
  });

  assert.equal(AIWebSearch.responsesEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1/responses");
  assert.equal(body.model, "gpt-4.1-mini");
  assert.equal(body.instructions, "你会给出来源。");
  assert.deepEqual(body.input, [{ role: "user", content: "今天有什么科技新闻？" }]);
  assert.deepEqual(body.tools, [{ type: "web_search", search_context_size: "medium" }]);
  assert.equal(body.tool_choice, "auto");
  assert.deepEqual(body.include, ["web_search_call.action.sources"]);
});

test("AI web search helper supports Chat Completions search models", () => {
  const AIWebSearch = require("../js/ai-web-search.js");
  const body = AIWebSearch.buildChatCompletionsSearchBody({
    model: "gpt-5-search-api",
    messages: [{ role: "user", content: "OpenAI 最新模型是什么？" }],
  });

  assert.equal(AIWebSearch.isChatCompletionsSearchModel("gpt-5-search-api"), true);
  assert.equal(AIWebSearch.isChatCompletionsSearchModel("gpt-4o-search-preview"), true);
  assert.equal(AIWebSearch.isChatCompletionsSearchModel("gpt-4o-mini-search-preview"), true);
  assert.equal(AIWebSearch.isChatCompletionsSearchModel("gpt-4.1-mini"), false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.web_search_options, { search_context_size: "medium" });
});

test("AI web search helper renders response text with sources", () => {
  const AIWebSearch = require("../js/ai-web-search.js");
  const content = AIWebSearch.renderResponsesMessage({
    output: [
      { type: "web_search_call", action: { sources: [{ url: "https://example.com/a", title: "A" }] } },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: "搜索完成。",
          annotations: [{ type: "url_citation", url: "https://example.com/b", title: "B" }],
        }],
      },
    ],
  });

  assert.match(content, /搜索完成。/);
  assert.match(content, /来源/);
  assert.match(content, /https:\/\/example\.com\/a/);
  assert.match(content, /https:\/\/example\.com\/b/);
});

test("AI web search UI is wired into the chat flow", () => {
  const assets = require("../js/static-assets.js");
  const index = fs.readFileSync("index.html", "utf8");
  const ai = fs.readFileSync("js/ai.js", "utf8");
  const app = fs.readFileSync("js/app.js", "utf8");

  assert.ok(assets.scripts.includes("js/ai-web-search.js"));
  assert.ok(index.indexOf('<script src="js/ai-web-search.js"></script>') >= 0);
  assert.ok(index.indexOf('<script src="js/ai-web-search.js"></script>') < index.indexOf('<script src="js/ai.js"></script>'));
  assert.match(index, /id="ai-web-search"/);
  assert.match(ai, /HomepageAIWebSearch/);
  assert.match(ai, /chatWithWebSearch/);
  assert.match(app, /webSearch:\s*AI\.AIStore\.data\.webSearchEnabled/);
  assert.match(app, /updateWebSearchButton/);
});
