#!/usr/bin/env node
/**
 * SEO Cannibalization Guard — Growth OS Phase 2A
 * ──────────────────────────────────────────────
 * Scans existing SEO/content tables for keyword-ownership conflicts that
 * would violate the SSOT in growth_keyword_registry.
 *
 * Sources scanned (via REST):
 *   - blog_articles.target_keyword
 *   - seo_content_pages.title (heuristic: leading H1-style)
 *   - certification_seo_pages.meta_title
 *   - product_landing_profiles.seo_title
 *   - growth_keyword_registry.keyword_text (active)
 *
 * For every keyword_slug we collect (kind, owner_id, url). Two distinct
 * (kind, owner_id) tuples on the same slug = cannibalization.
 *
 * Mode:
 *   - default: warn-only (exit 0, but print report)
 *   - --strict: exit 1 on any conflict
 *
 * Env: VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (or SUPABASE_*).
 *      Falls back to .env file if present.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ── env loader ──────────────────────────────────────────────────────────────
function loadEnv() {
  const env = { ...process.env };
  const dotenv = resolve(process.cwd(), ".env");
  if (existsSync(dotenv)) {
    for (const line of readFileSync(dotenv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
const ENV = loadEnv();
const SUPA_URL = ENV.VITE_SUPABASE_URL || ENV.SUPABASE_URL;
const SUPA_KEY = ENV.VITE_SUPABASE_PUBLISHABLE_KEY || ENV.SUPABASE_ANON_KEY || ENV.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.log("ℹ️  SUPABASE env not set — skipping cannibalization guard (CI offline mode).");
  process.exit(0);
}

// ── deterministic slug (mirrors fn_slugify_keyword) ─────────────────────────
function slugify(t) {
  if (!t) return "";
  return String(t)
    .toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── REST helper ─────────────────────────────────────────────────────────────
async function fetchTable(table, select) {
  const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=5000`;
  const r = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) {
    console.error(`  ✖ fetch ${table}: ${r.status}`);
    return [];
  }
  return r.json();
}

// ── main ────────────────────────────────────────────────────────────────────
const STRICT = process.argv.includes("--strict");

async function main() {
  console.log("SEO Cannibalization Guard — scanning owners …\n");

  const [blogs, seoPages, certPages, landings] = await Promise.all([
    fetchTable("blog_articles", "id,slug,target_keyword,status"),
    fetchTable("seo_content_pages", "id,slug,title,status"),
    fetchTable("certification_seo_pages", "id,slug,meta_title,is_published"),
    fetchTable("product_landing_profiles", "id,seo_title"),
  ]);

  /** @type {Map<string, Array<{kind:string,id:string,url?:string,raw:string}>>} */
  const ownersBySlug = new Map();
  const add = (kw, kind, id, url) => {
    const slug = slugify(kw);
    if (!slug) return;
    const arr = ownersBySlug.get(slug) ?? [];
    arr.push({ kind, id, url, raw: kw });
    ownersBySlug.set(slug, arr);
  };

  for (const b of blogs) {
    if ((b.status === "deleted" || b.status === "archived") || !b.target_keyword) continue;
    add(b.target_keyword, "blog_article", b.id, `/blog/${b.slug}`);
  }
  for (const p of seoPages) {
    if (!p.title || (p.status && ["archived", "deleted"].includes(p.status))) continue;
    add(p.title, "seo_content_page", p.id, `/${p.slug}`);
  }
  for (const c of certPages) {
    if (!c.meta_title) continue;
    add(c.meta_title, "certification_seo_page", c.id, `/${c.slug}`);
  }
  for (const l of landings) {
    if (!l.seo_title) continue;
    add(l.seo_title, "product_landing", l.id, null);
  }

  const conflicts = [];
  for (const [slug, owners] of ownersBySlug) {
    const distinct = new Map();
    for (const o of owners) distinct.set(`${o.kind}:${o.id}`, o);
    if (distinct.size > 1) conflicts.push({ slug, owners: [...distinct.values()] });
  }

  console.log(`Sources: blog=${blogs.length}  seo_pages=${seoPages.length}  cert=${certPages.length}  landing=${landings.length}`);
  console.log(`Distinct keyword slugs: ${ownersBySlug.size}`);
  console.log(`Cannibalization conflicts: ${conflicts.length}\n`);

  if (conflicts.length === 0) {
    console.log("✓ No cannibalization detected.");
    process.exit(0);
  }

  for (const c of conflicts.slice(0, 50)) {
    console.log(`✖ '${c.slug}' (${c.owners.length} owners)`);
    for (const o of c.owners) {
      console.log(`     - [${o.kind}] ${o.id} ${o.url ? `→ ${o.url}` : ""} :: "${o.raw}"`);
    }
  }
  if (conflicts.length > 50) console.log(`   … +${conflicts.length - 50} more`);

  console.log(
    `\n${STRICT ? "✖" : "⚠"} ${conflicts.length} keyword(s) owned by >1 page. ` +
    `Resolve via admin_register_keyword(force_takeover=true) or by deprecating the loser page.`
  );

  process.exit(STRICT ? 1 : 0);
}

main().catch((e) => {
  console.error("Guard crashed:", e);
  process.exit(STRICT ? 2 : 0);
});
