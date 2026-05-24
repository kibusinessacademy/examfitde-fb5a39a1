/**
 * E2E-Style CTA Route Guard Tests
 *
 * Static-scans the source tree for every internal link literal
 * (`to="/…"` and `href="/…"`) and asserts:
 *
 *  1. No CTA points to `/bundle/*` (hard ban — would 404 on Vercel).
 *  2. Every internal target resolves to a registered SPA route.
 *  3. SafeCta rewrites `/bundle/*` → `/paket/*` at runtime.
 *  4. SafeCta throws on unknown targets in test mode.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isKnownRoute, ROUTE_PATTERNS } from "@/lib/route-registry";
import { resolveSafeTarget } from "@/components/cta/SafeCta";

const SRC_ROOT = join(process.cwd(), "src");

const SCAN_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);
const SKIP_DIRS = new Set([
  "node_modules",
  "__tests__",
  "test",
  "tests",
  "integrations", // generated supabase types
]);
// Files that legitimately reference /bundle/ (legacy redirect components, route registry, this test, etc.)
const ALLOW_BUNDLE_LITERAL = [
  /[\\/]src[\\/]lib[\\/]route-registry\.ts$/,
  /[\\/]src[\\/]components[\\/]cta[\\/]SafeCta\.tsx$/,
  /[\\/]src[\\/]__tests__[\\/]cta-routes-no-bundle\.test\.tsx$/,
  /BundleToPaketRedirect/, // legacy redirect component
  /LegacyProductRedirect/,
  /AppRoutes\.tsx$/, // legacy redirect declarations
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(p, out);
    } else if (SCAN_EXTS.has(p.slice(p.lastIndexOf(".")))) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SRC_ROOT);

// Match `to="/..."` or `href="/..."` (single OR double quotes), excluding URL/template strings.
const LINK_RX = /(?:^|[\s{(,])(?:to|href)\s*=\s*["']\s*(\/[A-Za-z0-9\-_/]*)\s*["']/g;

interface Hit {
  file: string;
  target: string;
}

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  for (const file of FILES) {
    const src = readFileSync(file, "utf8");
    LINK_RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LINK_RX.exec(src)) !== null) {
      hits.push({ file: relative(process.cwd(), file), target: m[1] });
    }
  }
  return hits;
}

describe("CTA route registry sanity", () => {
  it("registers core marketing/funnel routes", () => {
    for (const expected of [
      "/",
      "/paket",
      "/paket/:slug",
      "/berufe",
      "/berufe/:slug",
      "/quiz/:slug",
      "/lernplan/:slug",
      "/pruefungscheck",
      "/enterprise-demo",
      "/auth",
      "/dashboard",
    ]) {
      expect(ROUTE_PATTERNS).toContain(expected);
    }
  });

  it("matches concrete routes including params", () => {
    expect(isKnownRoute("/paket/zimmerer-in")).toBe(true);
    expect(isKnownRoute("/berufe/zimmerer-in")).toBe(true);
    expect(isKnownRoute("/quiz/foo")).toBe(true);
    expect(isKnownRoute("/admin/heal")).toBe(true);
    expect(isKnownRoute("/admin/heal-cockpit/package/abc-123")).toBe(true);
    expect(isKnownRoute("/paket/zimmerer-in?utm=x#top")).toBe(true);
  });

  it("treats unknown internal paths as unknown", () => {
    expect(isKnownRoute("/this-route-does-not-exist-xyz")).toBe(false);
    expect(isKnownRoute("/admin/does-not-exist")).toBe(false);
  });

  it("treats external URLs as known", () => {
    expect(isKnownRoute("https://example.com")).toBe(true);
    expect(isKnownRoute("mailto:foo@bar")).toBe(true);
  });
});

describe("SafeCta runtime guard", () => {
  it("rewrites /bundle/* to /paket/*", () => {
    expect(resolveSafeTarget("/bundle/zimmerer-in")).toBe("/paket/zimmerer-in");
    expect(resolveSafeTarget("/bundle")).toBe("/paket");
  });

  it("returns valid known targets unchanged", () => {
    expect(resolveSafeTarget("/paket/zimmerer-in")).toBe("/paket/zimmerer-in");
    expect(resolveSafeTarget("/berufe")).toBe("/berufe");
  });

  it("throws on unknown targets in test mode", () => {
    expect(() => resolveSafeTarget("/totally-bogus-route-xyz")).toThrow(/Unknown route/);
  });
});

describe("Source tree CTA backlinks", () => {
  const hits = collectHits();

  it("scanned a non-trivial number of internal links", () => {
    expect(hits.length).toBeGreaterThan(20);
  });

  it("contains no forbidden /bundle/* literal in CTA targets", () => {
    const offenders = hits.filter(
      (h) =>
        (h.target === "/bundle" || h.target.startsWith("/bundle/")) &&
        !ALLOW_BUNDLE_LITERAL.some((rx) => rx.test(h.file)),
    );
    if (offenders.length) {
      const lines = offenders.map((o) => `  ${o.file} → ${o.target}`).join("\n");
      throw new Error(
        `Found ${offenders.length} forbidden /bundle/* CTA targets — use /paket/* instead:\n${lines}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("every internal target resolves to a registered route", () => {
    const dead = hits.filter((h) => !isKnownRoute(h.target));
    if (dead.length) {
      const lines = dead.map((o) => `  ${o.file} → ${o.target}`).join("\n");
      throw new Error(
        `Found ${dead.length} CTA targets pointing to unregistered routes:\n${lines}\n\n` +
          `Either register the route in src/routes/AppRoutes.tsx + src/lib/route-registry.ts, ` +
          `or fix the link.`,
      );
    }
    expect(dead).toEqual([]);
  });
});
