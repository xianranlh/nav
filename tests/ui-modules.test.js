const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const Render = require("../js/render-utils.js");
const LinkUI = require("../js/link-ui.js");
const AIUI = require("../js/ai-ui.js");
const CalendarUI = require("../js/calendar-ui.js");

test("render utils centralize HTML, URL, and CSS value safety", () => {
  assert.equal(Render.escapeHtml(`<img src=x onerror="1">`), "&lt;img src=x onerror=&quot;1&quot;&gt;");
  assert.equal(Render.safeUrlAttribute(" javascript:alert(1) "), "");
  assert.equal(Render.safeUrlAttribute("https://example.com/a?x=1"), "https://example.com/a?x=1");
  assert.equal(Render.safeUrlAttribute("/api/media/file/bg/a.png"), "/api/media/file/bg/a.png");
  assert.equal(Render.safeUrlAttribute("data:image/png;base64,abc"), "data:image/png;base64,abc");
  assert.equal(Render.safeCssColor("red;background:url(x)"), "#ff8fab");
  assert.equal(Render.safeCssColor("#123abc"), "#123abc");
  assert.equal(Render.safeCssColor("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
});

test("link UI helpers normalize form data and option markup", () => {
  assert.equal(LinkUI.normalizeUrl("example.com"), "https://example.com");
  assert.equal(LinkUI.normalizeUrl(" https://example.com "), "https://example.com");
  assert.equal(LinkUI.buildGroupOptionsHtml([
    { id: "dev", name: "<开发>" },
    { id: "life", name: "" },
  ]), `<option value="dev">&lt;开发&gt;</option><option value="life">未命名分组</option>`);

  assert.deepEqual(
    LinkUI.createInlineGroupDraft({ name: " 新分组 ", color: "", idFactory: () => "g1" }),
    { id: "g1", name: "新分组", color: "#f6a5c0", links: [] },
  );
});

test("AI UI helpers build escaped option and action snippets", () => {
  assert.equal(
    AIUI.renderPersonaOptions([
      { id: "nav", name: "导航" },
      { id: "bad", name: "<script>" },
    ], "bad"),
    `<option value="nav" >导航</option><option value="bad" selected>&lt;script&gt;</option>`,
  );
  assert.deepEqual(AIUI.modelChoices({ models: [], defaultModel: "gpt" }), ["gpt"]);
  assert.match(AIUI.renderEmptyState(), /ai-empty/);
  assert.doesNotMatch(
    AIUI.renderActionCard([{ op: "add_link", name: `<img onerror=1>` }], "act-1"),
    /<img onerror/,
  );
});

test("AI UI helpers render assistant images with preview and save controls", () => {
  const card = AIUI.renderImageCard({
    src: "https://img.example/cat.png?x=1",
    alt: "<猫>",
    id: "img-1",
  });

  assert.match(card, /class="ai-image-card"/);
  assert.match(card, /data-ai-image-preview/);
  assert.match(card, /data-ai-image-save/);
  assert.match(card, /&lt;猫&gt;/);
  assert.doesNotMatch(
    AIUI.renderImageCard({ src: "javascript:alert(1)", alt: "bad", id: "bad" }),
    /javascript:alert/,
  );

  const enhanced = AIUI.enhanceAssistantMediaHtml('<p>图</p><img class="ai-inline-img" alt="图" src="https://img.example/a.webp" loading="lazy" />');
  assert.match(enhanced, /ai-image-card/);
  assert.match(enhanced, /data-ai-image-preview/);
  assert.match(enhanced, /data-ai-image-save/);
});

test("AI thinking state renders inside the assistant bubble", () => {
  const html = AIUI.renderThinkingState("正在思考");
  const app = fs.readFileSync("js/app.js", "utf8");

  assert.match(html, /class="ai-thinking"/);
  assert.match(html, /role="status"/);
  assert.match(html, /正在思考/);
  assert.match(html, /ai-thinking-dots/);
  assert.match(app, /renderThinkingState/);
  assert.doesNotMatch(app, /tipEl\.textContent\s*=\s*"正在思考/);
});

test("AI UI helpers extract generated image payloads from common AI JSON responses", () => {
  assert.deepEqual(
    AIUI.extractGeneratedImages('```json\n{"data":[{"url":"https://img.example/out.png"}]}\n```'),
    [{ src: "https://img.example/out.png", alt: "AI 生成图片" }],
  );
  assert.deepEqual(
    AIUI.extractGeneratedImages('{"data":[{"b64_json":"abc123"}]}'),
    [{ src: "data:image/png;base64,abc123", alt: "AI 生成图片" }],
  );
  assert.deepEqual(AIUI.extractGeneratedImages('{"url":"javascript:alert(1)"}'), []);
});

test("AI UI helpers only treat real image tags as already rendered images", () => {
  assert.equal(
    AIUI.hasRenderedImageSrc('<pre><code>{"url":"https://img.example/out.png"}</code></pre>', "https://img.example/out.png"),
    false,
  );
  assert.equal(
    AIUI.hasRenderedImageSrc('<figure><img class="ai-inline-img" src="https://img.example/out.png" /></figure>', "https://img.example/out.png"),
    true,
  );
  assert.equal(
    AIUI.hasRenderedImageSrc('<figure><img class="ai-inline-img" src="https://img.example/out.png?x=1&amp;y=2" /></figure>', "https://img.example/out.png?x=1&y=2"),
    true,
  );
});

test("main app wires AI image preview and save interactions", () => {
  const app = fs.readFileSync("js/app.js", "utf8");
  const css = fs.readFileSync("css/ai.css", "utf8");

  assert.match(app, /function openLightbox\(src, alt/);
  assert.match(app, /function saveAiImage/);
  assert.match(app, /data-ai-image-save/);
  assert.match(app, /data-ai-image-preview/);
  assert.match(css, /\.ai-image-card/);
  assert.match(css, /\.ai-lightbox-toolbar/);
});

test("calendar UI helpers render dense month and task snippets safely", () => {
  const date = new Date("2026-04-30T00:00:00");
  const html = CalendarUI.renderMonthCell({
    cell: { date, inMonth: true },
    items: [{ task: { title: "<会议>", color: "red;background:bad" }, ts: date.getTime(), done: false }],
    todayTime: date.getTime(),
    selectedTime: date.getTime(),
    weatherBadgeHtml: "",
  });

  assert.match(html, /cal-cell/);
  assert.match(html, /&lt;会议&gt;/);
  assert.doesNotMatch(html, /background:bad/);
  assert.match(
    CalendarUI.renderTaskListItem({
      task: { id: "t1", title: "<任务>", color: "#123abc", allDay: false },
      ts: date.getTime(),
      done: false,
      dateTimeText: "09:00",
      countdownText: "还有 1 天",
    }),
    /&lt;任务&gt;/,
  );
});

test("main app delegates rendering-focused helpers to UI modules", () => {
  const app = fs.readFileSync("js/app.js", "utf8");
  const index = fs.readFileSync("index.html", "utf8");
  const assets = require("../js/static-assets.js");
  const appIdx = index.indexOf('<script src="js/app.js');

  for (const file of ["js/render-utils.js", "js/link-ui.js", "js/ai-ui.js", "js/calendar-ui.js"]) {
    const tagIdx = index.indexOf(`<script src="${file}"></script>`);
    assert.ok(tagIdx >= 0, `${file} should load on the page`);
    assert.ok(tagIdx < appIdx, `${file} should load before app.js`);
    assert.ok(assets.scripts.includes(file), `${file} should be precached`);
  }

  assert.match(app, /SakuraRender/);
  assert.match(app, /HomepageLinkUI/);
  assert.match(app, /HomepageAIUI/);
  assert.match(app, /HomepageCalendarUI/);
});
