/* 樱 · 个人导航 Service Worker
 * 策略：
 *   - 静态资源（本域 HTML/CSS/JS/JSON）：network-first（先走网络，离线回缓存）
 *   - favicon 图标（跨域）：cache-first，命中即返回，失败回网络
 *   - 其它（API、壁纸图等）：network-first，失败回缓存
 */
const VERSION = "v1.20.3";
const CORE_CACHE = `sakura-nav-core-${VERSION}`;
const RUNTIME_CACHE = `sakura-nav-runtime-${VERSION}`;

const CORE_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./themes/sakura.css",
  "./themes/q-anime.css",
  "./themes/dark-minimal.css",
  "./themes/paper.css",
  "./js/homepage-theme.js",
  "./js/homepage-layout.js",
  "./js/sakura.js",
  "./js/bookmarks.js",
  "./js/auth.js",
  "./js/ai.js",
  "./js/blog.js",
  "./js/calendar.js",
  "./js/holidays.js",
  "./js/todo.js",
  "./js/sync.js",
  "./js/weather.js",
  "./js/suggest.js",
  "./js/exporter.js",
  "./js/idb.js",
  "./js/music.js",
  "./js/storage-inspector.js",
  `./js/app.js?v=${VERSION}`,
  "./manifest.json",
];
const CORE_PATHS = CORE_FILES.map((file) => new URL(file, location.href).pathname);

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CORE_CACHE).then((c) => c.addAll(CORE_FILES)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![CORE_CACHE, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

function isCoreRequest(url) {
  return url.origin === location.origin &&
         (CORE_PATHS.some((path) => url.pathname === path || url.pathname.endsWith(path)) ||
          url.pathname === "/" || url.pathname === "/index.html");
}

function isIconRequest(req) {
  // 通常我们用 <img src=...> 加载，dest=image
  return req.destination === "image";
}

function isMediaRequest(req, url) {
  // 媒体（audio/video）通常带 Range；不应进入缓存策略，否则可能因 cache.put 失败/误缓存 206 导致播放异常
  if (req.destination === "audio" || req.destination === "video") return true;
  const p = (url && url.pathname ? url.pathname : "").toLowerCase();
  return /\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4|webm|mov|ogv)(?:$|\?)/i.test(p);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 扩展程序、blob、data 等 scheme 不能进 Cache API，交给浏览器默认行为
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  // 带鉴权头的请求（AI API / 同步）直接走网络
  if (req.headers.get("authorization")) return;
  // 媒体资源：不要缓存（避免 Range/大文件触发 cache.put 异常 → 被误判成 504）
  if (isMediaRequest(req, url)) return;
  // 动态 API：天气 / IP 定位 / 同步 / Gist，直接走网络
  const dynamicHosts = ["api.open-meteo.com", "ipapi.co", "ip-api.com", "api.github.com", "duckduckgo.com", "suggestion.baidu.com"];
  if (dynamicHosts.includes(url.hostname)) return;

  // 核心资源（HTML/CSS/JS）：network-first
  // 旧缓存策略会让客户端继续读旧资源直到再次刷新；
  // 改成先走网络，离线才回落到缓存，保证修复能尽快到达用户。
  if (isCoreRequest(url)) {
    event.respondWith(networkFirst(req, CORE_CACHE));
    return;
  }

  // 图标：cache-first
  if (isIconRequest(req)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // 其它：network-first
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try { cache.put(req, res.clone()); } catch (_) {}
    }
    return res;
  } catch (_) {
    return new Response("", { status: 504 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      try { cache.put(req, res.clone()); } catch (_) {}
    }
    return res;
  } catch (_) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response("", { status: 504 });
  }
}
