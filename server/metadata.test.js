import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeHttpUrl, extractTitleFromHtml, createTtlCache } from "./metadata.js";

test("isSafeHttpUrl rejects non-http schemes and localhost", async () => {
  assert.equal(await isSafeHttpUrl("file:///etc/passwd"), false);
  assert.equal(await isSafeHttpUrl("javascript:alert(1)"), false);
  assert.equal(await isSafeHttpUrl("http://localhost/"), false);
  assert.equal(await isSafeHttpUrl("http://127.0.0.1/"), false);
  assert.equal(await isSafeHttpUrl("http://192.168.1.1/"), false);
  assert.equal(await isSafeHttpUrl("http://10.0.0.1/"), false);
  assert.equal(await isSafeHttpUrl("not a url"), false);
});

test("isSafeHttpUrl accepts public https URL shape", async () => {
  // DNS 可能因环境失败；至少协议与 host 形态应通过私网 IP 直连校验路径
  assert.equal(await isSafeHttpUrl("https://1.1.1.1/"), true);
});

test("extractTitleFromHtml prefers og:title then <title>", () => {
  const html1 = `<html><head><meta property="og:title" content="OG Title"><title>Doc Title</title></head></html>`;
  assert.equal(extractTitleFromHtml(html1), "OG Title");

  const html2 = `<html><head><title>  Hello   World  </title></head></html>`;
  assert.equal(extractTitleFromHtml(html2), "Hello World");

  const html3 = `<html><head><meta content="Reversed" property="og:title"></head></html>`;
  assert.equal(extractTitleFromHtml(html3), "Reversed");

  const html4 = `<html><head><meta name="twitter:title" content="Tw Title"><title>Doc</title></head></html>`;
  assert.equal(extractTitleFromHtml(html4), "Tw Title");

  const html5 = `<html><head><title>A &amp; B &#39;C&#39;</title></head></html>`;
  assert.equal(extractTitleFromHtml(html5), "A & B 'C'");
});

test("createTtlCache stores and expires", async () => {
  const c = createTtlCache(30);
  c.set("k", { title: "t" });
  assert.deepEqual(c.get("k"), { title: "t" });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(c.get("k"), null);
});
