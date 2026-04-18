/* 浏览器书签解析器
 * 支持 Chrome / Edge / Firefox / Safari 导出的 Netscape Bookmark File Format (HTML)
 * 也支持 JSON (本工具导出的备份格式)
 */
(function () {
  /**
   * 解析 bookmarks.html 文本，返回分组数组
   * 结构：{ groups: [{ name, links: [{name, url, icon}] }] }
   * - 保留文件夹为分组，嵌套文件夹用 " / " 连接
   * - 根级无文件夹的链接放入 "未分类" 分组
   */
  function parseBookmarksHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // bookmark 文件的结构：<DL><DT><H3>Folder</H3><DL>...</DL>...
    // 但浏览器导出的 HTML 经常缺 </DT></DL>，DOMParser 对此的容错不一致。
    // 所以我们用更健壮的基于正则 / 遍历方式：通过 H3 与 A 的相对 DL 嵌套确定归属。

    // 如果 DOMParser 正确解析了 DL 树，直接用树遍历：
    const dlRoots = doc.querySelectorAll("body > dl, body > DL");
    const groups = [];
    const seenNames = new Map();

    function getOrCreateGroup(name) {
      if (!name) name = "未分类";
      if (seenNames.has(name)) return seenNames.get(name);
      const g = { name, links: [] };
      groups.push(g);
      seenNames.set(name, g);
      return g;
    }

    function walkDL(dl, pathName) {
      // 遍历 DL 的直接子节点：dt
      for (const child of dl.children) {
        if (child.tagName !== "DT") continue;
        // DT 里可能是 <H3>Folder</H3><DL>...</DL> 或 <A>link</A>
        const h3 = child.querySelector(":scope > h3");
        const a = child.querySelector(":scope > a");
        if (h3) {
          const subName = (h3.textContent || "").trim() || "未命名文件夹";
          const nested = child.querySelector(":scope > dl");
          const fullName = pathName ? `${pathName} / ${subName}` : subName;
          if (nested) walkDL(nested, fullName);
          else getOrCreateGroup(fullName);
        } else if (a) {
          const href = a.getAttribute("href");
          if (!href || /^(javascript|data):/i.test(href)) continue;
          const name = (a.textContent || "").trim() || href;
          const icon = a.getAttribute("icon") || "";
          const g = getOrCreateGroup(pathName);
          g.links.push({ name, url: href, icon });
        }
      }
    }

    if (dlRoots.length) {
      dlRoots.forEach((dl) => walkDL(dl, ""));
    }

    // 兜底：如果 DOM 解析什么也没拿到，按纯正则扫描所有 A
    if (groups.length === 0) {
      const re = /<A\s+[^>]*HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi;
      let m, fallback = getOrCreateGroup("未分类");
      while ((m = re.exec(html))) {
        const href = m[1];
        if (/^(javascript|data):/i.test(href)) continue;
        fallback.links.push({ name: m[2].trim(), url: href });
      }
    }

    // 清理空分组
    return groups.filter((g) => g.links.length > 0);
  }

  /**
   * 猜测一个网站的 favicon 候选列表（多级回退）
   * 使用多个第三方服务，避免单点失效
   */
  function iconCandidates(url) {
    try {
      const u = new URL(url);
      const host = u.hostname;
      return [
        `${u.protocol}//${host}/favicon.ico`,
        `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
        `https://icons.duckduckgo.com/ip3/${host}.ico`,
        `https://favicon.yandex.net/favicon/${host}`,
      ];
    } catch (e) {
      return [];
    }
  }

  /**
   * 尝试加载某个图标 URL，成功返回该 URL，失败返回 null
   */
  function tryLoadIcon(url, timeoutMs = 4000) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok ? url : null);
      };
      img.onload = () => {
        if (img.naturalWidth > 0) finish(true);
        else finish(false);
      };
      img.onerror = () => finish(false);
      img.referrerPolicy = "no-referrer";
      img.src = url;
      setTimeout(() => finish(false), timeoutMs);
    });
  }

  /**
   * 获取一个网址最好的 favicon（从候选列表中选第一个能加载的）
   */
  async function getBestIcon(url) {
    for (const candidate of iconCandidates(url)) {
      const ok = await tryLoadIcon(candidate);
      if (ok) return ok;
    }
    return null;
  }

  /**
   * 批量去重：同一 group 内 URL 相同的保留最早
   */
  function dedupe(groups) {
    const seen = new Set();
    for (const g of groups) {
      g.links = g.links.filter((l) => {
        const key = (l.url || "").trim();
        if (!key) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    return groups.filter((g) => g.links.length);
  }

  window.BookmarkTools = {
    parseBookmarksHTML,
    iconCandidates,
    tryLoadIcon,
    getBestIcon,
    dedupe,
  };
})();
