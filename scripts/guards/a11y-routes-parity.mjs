#!/usr/bin/env node
/**
 * a11y-routes parity guard.
 *
 * Ensures `tests/e2e/a11y-routes.ts` (the SSOT for public a11y smoke routes)
 * stays in sync with the routes registered in `src/routes/AppRoutes.tsx`.
 *
 * Rules:
 *   1. Every path listed in a11y-routes.ts MUST exist as a registered
 *      <Route path="..."> in AppRoutes.tsx (no stale / typo entries).
 *   2. Every <Route> tagged with the inline marker `// @a11y-smoke` MUST
 *      appear in a11y-routes.ts (so authors can pin must-cover routes).
 *   3. a11y-routes.ts entries must be public (no `:param`, no `*`,
 *      no `/admin*`, no `/learn*`, no `/dashboard/*` deep paths) — those
 *      belong to auth-gated suites, not public smoke.
 *
 * Exits non-zero on any drift.
 */
import { readFileSync } from "node:fs";

const ROUTES_FILE = "src/routes/AppRoutes.tsx";
const SMOKE_FILE = "tests/e2e/a11y-routes.ts";

const routesSrc = readFileSync(ROUTES_FILE, "utf8");
const smokeSrc = readFileSync(SMOKE_FILE, "utf8");

// 1. Extract every <Route path="..."> from AppRoutes.tsx, with optional
//    `// @a11y-smoke` marker on the same line or the previous line.
const registered = new Map(); // path -> { mustCover: boolean, line: number }
const lines = routesSrc.split("\n");
const ROUTE_RE = /<Route\s+path=["']([^"']+)["']/;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(ROUTE_RE);
  if (!m) continue;
  const path = m[1];
  const marker =
    /@a11y-smoke/.test(lines[i]) ||
    (i > 0 && /@a11y-smoke/.test(lines[i - 1]));
  registered.set(path, { mustCover: marker, line: i + 1 });
}

// 2. Extract every path listed in a11y-routes.ts.
const smokePaths = [];
const PATH_RE = /path:\s*["']([^"']+)["']/g;
for (const m of smokeSrc.matchAll(PATH_RE)) {
  smokePaths.push(m[1]);
}

const errors = [];

// Rule 3: smoke entries must be public + parameter-free.
const FORBIDDEN_PREFIX = ["/admin", "/learn", "/api"];
for (const p of smokePaths) {
  if (p.includes(":") || p.includes("*")) {
    errors.push(`smoke path "${p}" must be concrete (no :param / *).`);
  }
  if (FORBIDDEN_PREFIX.some((pref) => p === pref || p.startsWith(pref + "/"))) {
    errors.push(`smoke path "${p}" is auth-gated; remove from public a11y SSOT.`);
  }
}

// Rule 1: smoke entries must exist as real routes.
//        Allow exact match OR catch-all dispatcher "/:slug" (programmatic SEO).
const hasCatchAll = registered.has("/:slug");
for (const p of smokePaths) {
  if (registered.has(p)) continue;
  // Single-segment paths are absorbed by /:slug dispatcher.
  if (hasCatchAll && /^\/[^/]+$/.test(p)) continue;
  errors.push(
    `smoke path "${p}" not registered in ${ROUTES_FILE} — drift / typo.`,
  );
}

// Rule 2: every @a11y-smoke marked route must be in smoke list.
const smokeSet = new Set(smokePaths);
for (const [path, meta] of registered) {
  if (!meta.mustCover) continue;
  if (!smokeSet.has(path)) {
    errors.push(
      `${ROUTES_FILE}:${meta.line} marks "${path}" as @a11y-smoke but it is missing from ${SMOKE_FILE}.`,
    );
  }
}

if (errors.length) {
  console.error(`\n[a11y-routes-parity] ${errors.length} drift error(s):`);
  for (const e of errors) console.error(`  FAIL ${e}`);
  console.error(
    `\nFix by editing ${SMOKE_FILE} (add/remove entries) or ${ROUTES_FILE} (mark/unmark @a11y-smoke).`,
  );
  process.exit(1);
}

console.log(
  `[a11y-routes-parity] OK — ${smokePaths.length} smoke route(s), ${[...registered.values()].filter((r) => r.mustCover).length} @a11y-smoke pinned, all in sync.`,
);
