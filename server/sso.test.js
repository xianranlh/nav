import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintToken,
  verifyToken,
  cookieHeader,
  readCookie,
  isAllowedSsoTarget,
} from "./sso.js";

const SECRET = "a".repeat(64);

test("mint/verify round-trip", () => {
  const token = mintToken(SECRET, 1, 3600);
  const got = verifyToken(SECRET, token);
  assert.ok(got);
  assert.equal(got.userId, 1);
  assert.ok(got.exp > Math.floor(Date.now() / 1000));
});

test("verify rejects tampered, expired, and wrong secret", () => {
  const token = mintToken(SECRET, 7, 3600);
  assert.equal(verifyToken(SECRET, token.replace(/[0-9a-f]{4}$/, "abcd")), null);
  assert.equal(verifyToken("b".repeat(64), token), null);
  assert.equal(verifyToken(SECRET, ""), null);
  assert.equal(verifyToken(SECRET, "not-a-token"), null);
  const expired = mintToken(SECRET, 1, 1);
  const [exp, uid, sig] = expired.split(".");
  const past = String(Number(exp) - 120);
  assert.equal(verifyToken(SECRET, `${past}.${uid}.${sig}`), null);
});

test("cookie header sets parent domain and clears", () => {
  const set = cookieHeader("tok", { maxAgeSec: 99, domain: ".xianran.de" });
  assert.match(set, /xianran_sso=tok/);
  assert.match(set, /Domain=\.xianran\.de/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Max-Age=99/);
  const clr = cookieHeader("", { clear: true });
  assert.match(clr, /Max-Age=0/);
  assert.match(clr, /xianran_sso=;/);
});

test("readCookie picks xianran_sso", () => {
  assert.equal(readCookie("a=1; xianran_sso=abc.def; b=2"), "abc.def");
  assert.equal(readCookie(""), "");
});

test("isAllowedSsoTarget only allows xianran.de hosts", () => {
  assert.equal(isAllowedSsoTarget("https://home.xianran.de/"), true);
  assert.equal(isAllowedSsoTarget("https://xianran.de/"), true);
  assert.equal(isAllowedSsoTarget("http://nav.xianran.de/foo"), true);
  assert.equal(isAllowedSsoTarget("https://evil.com/"), false);
  assert.equal(isAllowedSsoTarget("https://xianran.de.evil.com/"), false);
  assert.equal(isAllowedSsoTarget("javascript:alert(1)"), false);
});
