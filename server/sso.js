/**
 * 闲然导航 → 本机反代站 SSO。
 * Cookie `xianran_sso`（Domain=.xianran.de）= `<exp>.<uid>.<hmac_sha1_hex>`，
 * 与 OpenResty access.lua 共用同一 secret 文件。
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const COOKIE_NAME = "xianran_sso";
const DEFAULT_DOMAIN = ".xianran.de";

export function loadOrCreateSecret(dataDir) {
  const fp = path.join(dataDir, "sso.secret");
  try {
    if (fs.existsSync(fp)) {
      const v = fs.readFileSync(fp, "utf8").trim();
      if (v) return v;
    }
  } catch (_) {}
  const secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(fp, secret + "\n", { mode: 0o600 });
  } catch (e) {
    console.warn("[sso] 无法写入 secret 文件：", e?.message || e);
  }
  return secret;
}

export function mintToken(secret, userId, ttlSec) {
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSec) || 0);
  const uid = String(userId);
  const payload = `${exp}.${uid}`;
  const sig = crypto.createHmac("sha1", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyToken(secret, token) {
  if (!secret || !token || typeof token !== "string") return null;
  const m = /^(\d+)\.(\d+)\.([0-9a-f]{40})$/.exec(token.trim());
  if (!m) return null;
  const exp = Number(m[1]);
  const uid = m[2];
  const sig = m[3];
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  const expect = crypto.createHmac("sha1", secret).update(`${exp}.${uid}`).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { userId: Number(uid), exp };
}

export function cookieHeader(token, { maxAgeSec, domain, clear } = {}) {
  const d = domain || process.env.SSO_COOKIE_DOMAIN || DEFAULT_DOMAIN;
  const base = `${COOKIE_NAME}=${clear ? "" : token}; Domain=${d}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (clear) return `${base}; Max-Age=0`;
  const age = Math.max(60, Number(maxAgeSec) || 7 * 24 * 3600);
  return `${base}; Max-Age=${age}`;
}

export function readCookie(cookieHeader, name = COOKIE_NAME) {
  if (!cookieHeader) return "";
  const parts = String(cookieHeader).split(/;\s*/);
  const prefix = name + "=";
  for (const p of parts) {
    if (p.startsWith(prefix)) return p.slice(prefix.length);
  }
  return "";
}

export function isAllowedSsoTarget(url, extraHosts = []) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "xianran.de" || h.endsWith(".xianran.de")) return true;
  return extraHosts.some((x) => x && (h === x || h.endsWith("." + x)));
}
