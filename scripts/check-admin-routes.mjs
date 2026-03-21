#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const routerCandidates = [
  "src/App.tsx",
  "src/main.tsx",
  "src/router.tsx",
  "src/router/index.tsx",
  "src/routes.tsx",
  "src/routes/index.tsx",
  "src/app/router.tsx",
];

const allowed = [
  "/admin",
  "/admin/command",
  "/admin/studio",
  "/admin/studio/:packageId",
  "/admin/queue",
  "/admin/*",
];

const legacyRedirectPrefixes = [
  "/admin/dashboard",
  "/admin/home",
  "/admin/courses",
  "/admin/course-studio",
  "/admin/packages/",
  "/admin/berufski/",
  "/admin/control-tower",
  "/admin/leitstelle",
  "/admin/system/",
  "/admin/business/",
  "/admin/revenue/",
  "/admin/content/",
  "/admin/crm/",
  "/admin/support/",
  "/admin/quality/",
  "/admin/finance/",
  "/admin/council/",
  "/admin/jobs/",
  "/admin/ops/queue/",
];

const found = [];
const violations = [];

for (const candidate of routerCandidates) {
  const abs = path.join(ROOT, candidate);
  if (!fs.existsSync(abs)) continue;

  const content = fs.readFileSync(abs, "utf8");
  const regex = /["'`](\/admin[^"'`]*)["'`]/g;

  let match;
  while ((match = regex.exec(content)) !== null) {
    const route = match[1];
    found.push({ file: candidate, route });

    const isAllowed = allowed.includes(route);
    const isLegacyRedirect = legacyRedirectPrefixes.some((p) => route.startsWith(p));

    if (!isAllowed && !isLegacyRedirect) {
      violations.push(`${candidate}: disallowed admin route reference "${route}"`);
    }
  }
}

if (violations.length) {
  console.error("\n❌ Disallowed admin routes detected:\n");
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log("✅ Admin route scan passed.");
if (found.length) {
  console.log("\nDetected admin route references:");
  for (const item of found) {
    console.log(`- ${item.file}: ${item.route}`);
  }
}
