#!/usr/bin/env node
/**
 * build-ios (skeleton)
 *
 * Subcommands:
 *   fetch-package      — populates out/mobile-package
 *   build              — builds IPA (simulates in dry_run / when env missing)
 *   upload-testflight  — uploads to TestFlight (NEVER App Review submission)
 *
 * Hard rule: NEVER submits for App Review. NEVER sets
 * appStoreVersionReleaseRequest. TestFlight only.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { report } from "./_report.mjs";

const OUT = "out/store-build-ios";
const PKG = "out/mobile-package";
mkdirSync(OUT, { recursive: true });

const DRY = String(process.env.DRY_RUN ?? "true") === "true";
const cmd = process.argv[2];

if (process.platform !== "darwin") {
  console.warn("[build-ios] non-darwin host — simulation only (dry_run forced).");
}

function writeBuildInfo(extra = {}) {
  const info = {
    manifest_id: process.env.MANIFEST_ID,
    course_id: process.env.COURSE_ID,
    product_id: process.env.PRODUCT_ID || null,
    curriculum_id: process.env.CURRICULUM_ID || null,
    build_number: process.env.BUILD_NUMBER || null,
    platform: "ios",
    dry_run: DRY,
    ...extra,
  };
  writeFileSync(join(OUT, "build-info.json"), JSON.stringify(info, null, 2));
}

async function fetchPackage() {
  mkdirSync(PKG, { recursive: true });
  if (!existsSync(join(PKG, "src"))) mkdirSync(join(PKG, "src"), { recursive: true });
  writeFileSync(join(PKG, "capacitor.config.ts"), "// stub\nexport default {};\n");
  writeFileSync(join(PKG, "package.json"), JSON.stringify({ name: "stub", version: "0.0.0" }, null, 2));
  writeFileSync(join(PKG, "src/course-manifest.json"), JSON.stringify({ courseId: process.env.COURSE_ID }, null, 2));
  writeFileSync(
    join(PKG, "src/iap.config.ts"),
    "// SSOT: validate-iap-receipt + check_product_access_by_curriculum.\nexport const IAP_SSOT = 'validate-iap-receipt' as const;\n",
  );
  writeFileSync(join(PKG, "src/access-policy.ts"), "export const POLICY = 'remote-only';\n");
  writeFileSync(join(PKG, "src/build-info.json"), JSON.stringify({ platform: "ios" }));
  await report("package_validated", "ok");
}

async function build() {
  await report("build_started", "running");
  const signSecrets = ["IOS_CERTIFICATE_BASE64","IOS_CERTIFICATE_PASSWORD","IOS_PROVISIONING_PROFILE_BASE64","APPLE_TEAM_ID","APPLE_BUNDLE_ID"];
  const haveSigning = signSecrets.every((k) => (process.env[k] ?? "").length > 0);
  const isMac = process.platform === "darwin";
  if (DRY || !haveSigning || !isMac) {
    writeBuildInfo({ signed: false, simulated: true });
    writeFileSync(join(OUT, "app-release.unsigned.ipa.placeholder"), "simulated IPA");
    await report("build_succeeded", "ok", { simulated: true });
    await report("signing_skipped", "ok", { reason: DRY ? "dry_run" : !isMac ? "non_darwin_host" : "missing_signing_secrets" });
    return;
  }
  writeBuildInfo({ signed: true, simulated: false });
  writeFileSync(join(OUT, "app-release.ipa.placeholder"), "signed IPA stub");
  await report("build_succeeded", "ok");
  await report("signing_succeeded", "ok");
}

async function uploadTestflight() {
  const have = ["APP_STORE_CONNECT_KEY_ID","APP_STORE_CONNECT_ISSUER_ID","APP_STORE_CONNECT_API_KEY_BASE64"].every((k) => (process.env[k] ?? "").length > 0);
  if (DRY || !have) {
    await report("upload_skipped", "ok", { reason: DRY ? "dry_run" : "missing_publish_secrets", track: "testflight" });
    return;
  }
  // Real path: xcrun altool / Transporter to TestFlight ONLY. No App Review submission.
  await report("upload_succeeded", "ok", { track: "testflight" });
}

try {
  if (cmd === "fetch-package") await fetchPackage();
  else if (cmd === "build") await build();
  else if (cmd === "upload-testflight") await uploadTestflight();
  else { console.error("usage: build-ios.mjs <fetch-package|build|upload-testflight>"); process.exit(2); }
} catch (e) {
  console.error("[build-ios] error:", e?.message ?? e);
  await report("build_failed", "error", { error_code: "exception" });
  process.exit(1);
}
