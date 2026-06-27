#!/usr/bin/env node
/**
 * validate-mobile-package
 *
 * Validates a fetched mobile package directory (out/mobile-package/) against
 * the Phase-C contract:
 *   - required files present
 *   - no secrets in any file
 *   - no admin routes referenced
 *   - IAP-SSOT strings present in iap.config.ts
 *
 * Exits non-zero on contract violation.
 */
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.MOBILE_PACKAGE_DIR || "out/mobile-package";

if (!existsSync(ROOT)) {
  console.warn(`[validate] no package at ${ROOT} — skipping (build-* script generates stub)`);
  process.exit(0);
}

const REQUIRED = [
  "capacitor.config.ts",
  "package.json",
  "src/course-manifest.json",
  "src/iap.config.ts",
  "src/access-policy.ts",
  "src/build-info.json",
];

const FORBIDDEN_SECRETS = [
  /service_role/i,
  /sk_live_/,
  /sk_test_/,
  /APP_STORE_CONNECT_API_KEY/,
  /GOOGLE_APPLICATION_CREDENTIALS/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /STORE_RELEASE_STATUS_CALLBACK_SECRET/,
  /GITHUB_TOKEN/,
  /ANDROID_KEYSTORE/,
];
const FORBIDDEN_ADMIN_ROUTES = [
  "/admin/tools/mobile-iap-smoke",
  "/admin/tools",
  "/admin/",
];
const FORBIDDEN_SHADOW_IDS = [
  "grantMobileAccess",
  "unlockCourseLocally",
  "createMobileEntitlement",
  "validateReceiptClientSide",
];
const REQUIRED_IAP_SSOT = ["validate-iap-receipt", "check_product_access_by_curriculum"];

const errors = [];

for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) errors.push(`missing: ${rel}`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

for (const file of walk(ROOT)) {
  const content = readFileSync(file, "utf8");
  for (const re of FORBIDDEN_SECRETS) {
    if (re.test(content)) errors.push(`secret leak in ${file}: ${re}`);
  }
  for (const route of FORBIDDEN_ADMIN_ROUTES) {
    if (content.includes(route)) errors.push(`admin route in ${file}: ${route}`);
  }
  for (const id of FORBIDDEN_SHADOW_IDS) {
    if (content.includes(id)) errors.push(`shadow path in ${file}: ${id}`);
  }
}

const iap = join(ROOT, "src/iap.config.ts");
if (existsSync(iap)) {
  const txt = readFileSync(iap, "utf8");
  for (const s of REQUIRED_IAP_SSOT) {
    if (!txt.includes(s)) errors.push(`iap.config.ts missing SSOT reference: ${s}`);
  }
}

if (errors.length) {
  console.error("[validate] FAILED");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("[validate] ok");
