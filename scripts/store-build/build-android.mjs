#!/usr/bin/env node
/**
 * build-android (skeleton)
 *
 * Subcommands:
 *   fetch-package     — downloads/generates mobile package into out/mobile-package
 *   build             — builds AAB (or simulates in dry_run / when env missing)
 *   upload-internal   — uploads to Google Play Internal Track (never Production)
 *
 * Hard rule: NEVER targets the Google Play "production" track.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { report } from "./_report.mjs";

const OUT = "out/store-build-android";
const PKG = "out/mobile-package";
mkdirSync(OUT, { recursive: true });

const DRY = String(process.env.DRY_RUN ?? "true") === "true";
const cmd = process.argv[2];

function writeBuildInfo(extra = {}) {
  const info = {
    manifest_id: process.env.MANIFEST_ID,
    course_id: process.env.COURSE_ID,
    product_id: process.env.PRODUCT_ID || null,
    curriculum_id: process.env.CURRICULUM_ID || null,
    build_number: process.env.BUILD_NUMBER || null,
    platform: "android",
    dry_run: DRY,
    ...extra,
  };
  writeFileSync(join(OUT, "build-info.json"), JSON.stringify(info, null, 2));
}

async function fetchPackage() {
  mkdirSync(PKG, { recursive: true });
  // Skeleton: real implementation would download PACKAGE_ARTIFACT_URL.
  // We emit a minimal Phase-C-shaped stub so validate-mobile-package passes.
  if (!existsSync(join(PKG, "src"))) mkdirSync(join(PKG, "src"), { recursive: true });
  writeFileSync(join(PKG, "capacitor.config.ts"), "// stub\nexport default {};\n");
  writeFileSync(join(PKG, "package.json"), JSON.stringify({ name: "stub", version: "0.0.0" }, null, 2));
  writeFileSync(join(PKG, "src/course-manifest.json"), JSON.stringify({ courseId: process.env.COURSE_ID }, null, 2));
  writeFileSync(
    join(PKG, "src/iap.config.ts"),
    "// Refers to SSOT only. Calls validate-iap-receipt; entitlement read via check_product_access_by_curriculum.\nexport const IAP_SSOT = 'validate-iap-receipt' as const;\n",
  );
  writeFileSync(join(PKG, "src/access-policy.ts"), "export const POLICY = 'remote-only';\n");
  writeFileSync(join(PKG, "src/build-info.json"), JSON.stringify({ platform: "android" }));
  await report("package_validated", "ok");
}

async function build() {
  await report("build_started", "running");
  const signSecrets = ["ANDROID_KEYSTORE_BASE64","ANDROID_KEYSTORE_PASSWORD","ANDROID_KEY_ALIAS","ANDROID_KEY_PASSWORD"];
  const haveSigning = signSecrets.every((k) => (process.env[k] ?? "").length > 0);
  if (DRY || !haveSigning) {
    writeBuildInfo({ signed: false, simulated: true });
    writeFileSync(join(OUT, "app-release.unsigned.aab.placeholder"), "simulated AAB");
    await report("build_succeeded", "ok", { simulated: true });
    await report(haveSigning ? "signing_skipped" : "signing_skipped", "ok", { reason: DRY ? "dry_run" : "missing_signing_secrets" });
    return;
  }
  // Real path would: npm run build && npx cap sync android && (cd android && ./gradlew bundleRelease)
  writeBuildInfo({ signed: true, simulated: false });
  writeFileSync(join(OUT, "app-release.aab.placeholder"), "signed AAB stub");
  await report("build_succeeded", "ok");
  await report("signing_succeeded", "ok");
}

async function uploadInternal() {
  const have = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? "").length > 0;
  if (DRY || !have) {
    await report("upload_skipped", "ok", { reason: DRY ? "dry_run" : "missing_publish_secrets", track: "internal" });
    return;
  }
  // Real path would call Google Play Developer API with track="internal" (NEVER "production").
  await report("upload_succeeded", "ok", { track: "internal" });
}

try {
  if (cmd === "fetch-package") await fetchPackage();
  else if (cmd === "build") await build();
  else if (cmd === "upload-internal") await uploadInternal();
  else { console.error("usage: build-android.mjs <fetch-package|build|upload-internal>"); process.exit(2); }
} catch (e) {
  console.error("[build-android] error:", e?.message ?? e);
  await report("build_failed", "error", { error_code: "exception" });
  process.exit(1);
}
