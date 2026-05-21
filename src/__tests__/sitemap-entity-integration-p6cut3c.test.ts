/**
 * P6 Cut 3c — Blog + Wissen + Prüfungstraining Sitemap Parity (file-level contract).
 *
 * Asserts that the generate-sitemap function reads from SSOT views
 * (`v_blog_sitemap_entries`, `v_wissen_sitemap_entries`,
 * `v_pruefungstraining_sitemap_entries`) instead of ad-hoc table queries,
 * does not select the non-existent `noindex` column on `seo_documents`
 * or `blog_articles`, logs per-class counts, and keeps the forbidden-prefix
 * hard-gate active. DB count parity is enforced by the matching migration's
 * UNIQUE DISTINCT-ON dedupe inside each view.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITEMAP_FN = path.join(ROOT, 'supabase/functions/generate-sitemap/index.ts');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');

function migrationsConcat(): string {
  return fs
    .readdirSync(MIG_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIG_DIR, f), 'utf8'))
    .join('\n');
}

describe('P6 Cut 3c — blog + wissen + pruefungstraining sitemap parity', () => {
  const sql = migrationsConcat();
  const fn = fs.readFileSync(SITEMAP_FN, 'utf8');

  it('defines all three SSOT entity views', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_blog_sitemap_entries/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_wissen_sitemap_entries/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.v_pruefungstraining_sitemap_entries/);
  });

  it('locks views to service_role (no anon/authenticated SELECT)', () => {
    for (const v of [
      'v_blog_sitemap_entries',
      'v_wissen_sitemap_entries',
      'v_pruefungstraining_sitemap_entries',
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${v} FROM PUBLIC, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON public\\.${v} TO service_role`));
    }
  });

  it('blog branch reads from v_blog_sitemap_entries (no blog_articles/blog_posts direct queries)', () => {
    const blogBranch = fn.match(
      /if \(action === "blog"\)[\s\S]+?return xmlResponse\(toSitemapXML\(urls\)/,
    )![0];
    expect(blogBranch).toMatch(/v_blog_sitemap_entries/);
    expect(blogBranch).not.toMatch(/\.from\("blog_articles"\)/);
    expect(blogBranch).not.toMatch(/\.from\("blog_posts"\)/);
  });

  it('landing branch reads from v_pruefungstraining_sitemap_entries (no noindex on seo_documents)', () => {
    const branch = fn.match(
      /if \(action === "landing"\)[\s\S]+?return xmlResponse\(toSitemapXML\(urls\)/,
    )![0];
    expect(branch).toMatch(/v_pruefungstraining_sitemap_entries/);
    // critical: must not select non-existent noindex column on seo_documents
    expect(branch).not.toMatch(/seo_documents[\s\S]*noindex/);
  });

  it('content/wissen branch reads from v_wissen_sitemap_entries (no noindex on seo_documents)', () => {
    const branch = fn.match(
      /if \(action === "content"\)[\s\S]+?return xmlResponse\(toSitemapXML\(urls\)/,
    )![0];
    expect(branch).toMatch(/v_wissen_sitemap_entries/);
    expect(branch).not.toMatch(/seo_documents[\s\S]*noindex/);
  });

  it('emits per-class count logs (blog | pruefungstraining | berufe | content)', () => {
    expect(fn).toMatch(/class=blog count=/);
    expect(fn).toMatch(/class=pruefungstraining count=/);
    expect(fn).toMatch(/class=berufe total=/);
    expect(fn).toMatch(/class=content total=/);
  });

  it('keeps the forbidden-prefix hard-gate from Cut 3b active', () => {
    expect(fn).toMatch(/SITEMAP_FORBIDDEN_PREFIXES/);
    expect(fn).toMatch(/function toSitemapXML\(urlsIn: SitemapURL\[\]\)[\s\S]+?urlsIn\.filter\(\(u\) => isAllowedSitemapPath/);
  });

  it('registers sitemap_class_counts audit contract', () => {
    expect(sql).toMatch(/'sitemap_class_counts'/);
  });
});
