#!/usr/bin/env python3
"""Generate a consistent SVG icon set for 本机站点 and write URLs into the nav bundle."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

OUT_DIR = Path("/root/nav/data/xianran-nav/media/icon")
DB_PATH = Path("/root/nav/data/xianran-nav/sakura.db")
URL_PREFIX = "/api/media/file/icon"


def svg(c1: str, c2: str, glyph: str, gid: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="{gid}" x1="12" y1="4" x2="52" y2="62">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#{gid})"/>
  <path d="M16 2.5h32a13.5 13.5 0 0 1 13.5 13.5v10H2.5V16A13.5 13.5 0 0 1 16 2.5Z" fill="#fff" opacity=".14"/>
  {glyph}
</svg>
"""


W = 'fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"'
WF = 'fill="#fff"'

ICONS = {
    "home": svg(
        "#0f766e",
        "#2dd4bf",
        f"""
  <circle cx="32" cy="32" r="16" {W}/>
  <path d="M32 16v4M32 44v4M16 32h4M44 32h4" {W}/>
  <path d="M32 24l8 8-8 8-8-8z" {WF}/>
""",
        "g-home",
    ),
    "panel": svg(
        "#1d4ed8",
        "#60a5fa",
        f"""
  <rect x="15" y="14" width="34" height="11" rx="3" {WF}/>
  <rect x="15" y="28" width="34" height="11" rx="3" {WF}/>
  <rect x="15" y="42" width="34" height="8" rx="3" {WF}/>
  <circle cx="21" cy="19.5" r="1.8" fill="#1d4ed8"/>
  <circle cx="21" cy="33.5" r="1.8" fill="#1d4ed8"/>
  <path d="M27 19.5h16M27 33.5h12" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round"/>
""",
        "g-panel",
    ),
    "authentik": svg(
        "#ea580c",
        "#fb923c",
        f"""
  <path d="M32 12l16 6v14c0 11-7.5 18.5-16 22-8.5-3.5-16-11-16-22V18z" {WF}/>
  <circle cx="32" cy="30" r="4.2" fill="#ea580c"/>
  <path d="M32 34.2v6.5" stroke="#ea580c" stroke-width="3" stroke-linecap="round"/>
""",
        "g-auth",
    ),
    "minio": svg(
        "#be123c",
        "#fb7185",
        f"""
  <path d="M18 26h28v20c0 2.2-2.2 4-6 4H24c-3.8 0-6-1.8-6-4z" {WF}/>
  <ellipse cx="32" cy="26" rx="14" ry="7" {WF}/>
  <path d="M20 26c0 3.6 5.4 6.5 12 6.5s12-2.9 12-6.5" {W}/>
""",
        "g-minio",
    ),
    "astrbot": svg(
        "#4f46e5",
        "#818cf8",
        f"""
  <rect x="18" y="20" width="28" height="26" rx="8" {WF}/>
  <circle cx="32" cy="14" r="3" {WF}/>
  <path d="M32 17v3" {W}/>
  <circle cx="26" cy="31" r="2.4" fill="#4f46e5"/>
  <circle cx="38" cy="31" r="2.4" fill="#4f46e5"/>
  <path d="M27 39h10" stroke="#4f46e5" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M18 30h-4M46 30h4" {W}/>
""",
        "g-astr",
    ),
    "newapi": svg(
        "#0369a1",
        "#38bdf8",
        f"""
  <circle cx="20" cy="32" r="6" {WF}/>
  <circle cx="44" cy="20" r="5" {WF}/>
  <circle cx="44" cy="44" r="5" {WF}/>
  <path d="M25.5 29.5L39.5 22.2M25.5 34.5L39.5 41.8" {W}/>
""",
        "g-newapi",
    ),
    "cpa": svg(
        "#15803d",
        "#4ade80",
        f"""
  <rect x="14" y="16" width="36" height="32" rx="6" {W}/>
  <path d="M24 28l6 6-6 6" {W}/>
  <path d="M34 40h10" {W}/>
""",
        "g-cpa",
    ),
    "grok": svg(
        "#111827",
        "#4b5563",
        f"""
  <path d="M32 12l3.2 10.4H46l-8.6 6.4 3.2 10.4L32 33.2l-8.6 6 3.2-10.4L18 22.4h10.8z" {WF}/>
  <circle cx="48" cy="46" r="3.2" {WF}/>
  <circle cx="16" cy="18" r="2.2" {WF}/>
""",
        "g-grok",
    ),
    "tavern": svg(
        "#be123c",
        "#fb7185",
        f"""
  <path d="M22 22h16c1 8 1 16-2 24H24c-3-8-3-16-2-24z" {WF}/>
  <path d="M38 28h6c3 0 5 3 5 6s-2 6-5 6h-4" {W}/>
  <path d="M24 18c2-4 14-4 16 0" {W}/>
""",
        "g-tavern",
    ),
    "gying": svg(
        "#b45309",
        "#fbbf24",
        f"""
  <rect x="16" y="18" width="32" height="28" rx="3" {WF}/>
  <path d="M16 26h32M24 18v8M40 18v8" stroke="#b45309" stroke-width="2.6"/>
  <path d="M28 34l10 6-10 6z" fill="#b45309"/>
""",
        "g-gying",
    ),
    "jellyfin": svg(
        "#7e22ce",
        "#c084fc",
        f"""
  <path d="M26 18l20 14-20 14z" {WF}/>
  <path d="M18 16c12 8 12 24 0 32" {W}/>
""",
        "g-jelly",
    ),
    "komga": svg(
        "#166534",
        "#4ade80",
        f"""
  <path d="M18 16h10c6 0 8 3 8 8v26c-4-3-8-4-18-4z" {WF}/>
  <path d="M46 16H36c-6 0-8 3-8 8v26c4-3 8-4 18-4z" {WF}/>
  <path d="M32 24v26" stroke="#166534" stroke-width="2"/>
""",
        "g-komga",
    ),
    "kalo": svg(
        "#6d28d9",
        "#a78bfa",
        f"""
  <circle cx="32" cy="30" r="14" {W}/>
  <circle cx="32" cy="30" r="6" {W}/>
  <circle cx="32" cy="30" r="2.2" {WF}/>
  <path d="M32 44v6M28 50h8" {W}/>
""",
        "g-kalo",
    ),
    "jm": svg(
        "#dc2626",
        "#fb7185",
        f"""
  <path d="M32 12l5 12 13 1-10 8 4 13-12-7-12 7 4-13-10-8 13-1z" {WF}/>
""",
        "g-jm",
    ),
    "lsky": svg(
        "#1d4ed8",
        "#67e8f9",
        f"""
  <rect x="14" y="18" width="36" height="28" rx="5" {W}/>
  <circle cx="24" cy="28" r="3.2" {WF}/>
  <path d="M16 40l10-10 8 8 6-6 10 10" {W}/>
""",
        "g-lsky",
    ),
    "clip": svg(
        "#c2410c",
        "#fdba74",
        f"""
  <path d="M22 20h18l6 6v22H22z" {WF}/>
  <path d="M40 20v6h6" stroke="#c2410c" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M28 14c0-3 8-3 8 2v10" {W}/>
  <path d="M26 36h12M26 42h8" stroke="#c2410c" stroke-width="2.2" stroke-linecap="round"/>
""",
        "g-clip",
    ),
    "obsidian": svg(
        "#5b21b6",
        "#c4b5fd",
        f"""
  <path d="M32 12l14 10v16L32 52 18 38V22z" {WF}/>
  <path d="M32 22v18M25 28h14" stroke="#5b21b6" stroke-width="2.4" stroke-linecap="round"/>
""",
        "g-obs",
    ),
    "openwrite": svg(
        "#0f766e",
        "#5eead4",
        f"""
  <path d="M18 44l8-22 6 2-8 22z" {WF}/>
  <path d="M26 22l4-6 8 4-4 6" {WF}/>
  <path d="M20 48h24" {W}/>
  <circle cx="30" cy="16" r="1.8" {WF}/>
""",
        "g-write",
    ),
    "farm": svg(
        "#3f6212",
        "#a3e635",
        f"""
  <path d="M32 18c-6 8-8 14-8 20 0 6 3.5 10 8 10s8-4 8-10c0-6-2-12-8-20z" {WF}/>
  <path d="M32 48V54M24 36c-6 2-10 0-12-4M40 36c6 2 10 0 12-4" {W}/>
""",
        "g-farm",
    ),
    "xiuxian": svg(
        "#1e3a5f",
        "#d4a017",
        f"""
  <path d="M12 46l20-24 20 24z" {WF}/>
  <path d="M24 46l8-12 8 12z" fill="#1e3a5f" opacity=".35"/>
  <path d="M32 14l2.2 6.6H41l-5.6 4.2 2.2 6.6L32 27.4l-5.6 4 2.2-6.6-5.6-4.2h6.8z" {WF}/>
""",
        "g-xx",
    ),
}

HOST_TO_SLUG = {
    "home.xianran.de": "home",
    "netcup.xianran.de": "panel",
    "auth.xianran.de": "authentik",
    "minio.xianran.de": "minio",
    "astr.xianran.de": "astrbot",
    "newapi.xianran.de": "newapi",
    "cpa.xianran.de": "cpa",
    "chat.xianran.de": "grok",
    "sill.xianran.de": "tavern",
    "gy.xianran.de": "gying",
    "jellyfin.xianran.de": "jellyfin",
    "komga.xianran.de": "komga",
    "kalo.xianran.de": "kalo",
    "jm.xianran.de": "jm",
    "img.xianran.de": "lsky",
    "clip.xianran.de": "clip",
    "obsync.xianran.de": "obsidian",
    "openwrite.xianran.de": "openwrite",
    "comic.xianran.de": "farm",
    "xiuxian.xianran.de": "xiuxian",
}


def host_of(url: str) -> str:
    try:
        from urllib.parse import urlparse

        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def write_icons() -> dict[str, str]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping = {}
    for slug, body in ICONS.items():
        path = OUT_DIR / f"{slug}.svg"
        path.write_text(body.strip() + "\n", encoding="utf-8")
        mapping[slug] = f"{URL_PREFIX}/{slug}.svg"
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return mapping


def patch_bundle(mapping: dict[str, str]) -> None:
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.isolation_level = None
    row = conn.execute("SELECT payload FROM user_data WHERE user_id = 1").fetchone()
    if not row:
        raise SystemExit("user_data missing")
    data = json.loads(row[0])
    groups = (data.get("nav") or {}).get("groups") or []
    updated = 0
    for g in groups:
        for link in g.get("links") or []:
            host = host_of(link.get("url") or "")
            slug = HOST_TO_SLUG.get(host)
            if not slug:
                continue
            new_icon = mapping[slug]
            if link.get("icon") != new_icon:
                link["icon"] = new_icon
                updated += 1
                print(f"  {g.get('name')} / {link.get('name')} -> {new_icon}")
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    conn.execute(
        "UPDATE user_data SET payload = ?, updated_at = ? WHERE user_id = 1",
        (raw, int(__import__("time").time() * 1000)),
    )
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    print(f"updated {updated} links")


def main() -> None:
    mapping = write_icons()
    patch_bundle(mapping)


if __name__ == "__main__":
    main()
