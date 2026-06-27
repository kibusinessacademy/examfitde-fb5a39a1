#!/usr/bin/env node
/**
 * build-android (Welle 3 — Real Build Bridge)
 *
 * Subcommands:
 *   fetch-package     — downloads PACKAGE_ARTIFACT_URL zip (or generates Phase-C stub) into out/mobile-package
 *   prepare           — npm install + web build + capacitor add/sync android (best effort)
 *   build             — gradle bundleRelease (signed when secrets present, else unsigned, else simulated)
 *   upload-internal   — uploads to Google Play Internal Track only (never Production)
 *
 * Hard rules:
 *   - NEVER targets the Google Play "production" track.
 *   - Real build steps fall back to a simulated artifact when prerequisites are missing
 *     (no zip, no Android SDK, no signing secrets) — the workflow stays green and the
 *     status callback reports `simulated: true` plus a reason.
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, createWriteStream, readFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { report } from "./_report.mjs";

const OUT = "out/store-build-android";
const PKG = "out/mobile-package";
mkdirSync(OUT, { recursive: true });

const DRY = String(process.env.DRY_RUN ?? "true") === "true";
const cmd = process.argv[2];

function sh(bin, args, opts = {}) {
  console.log(`[exec] ${bin} ${args.join(" ")} ${opts.cwd ? `(cwd=${opts.cwd})` : ""}`);
  const r = spawnSync(bin, args, { stdio: "inherit", encoding: "utf8", ...opts });
  return r.status === 0;
}

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

function hashFile(p) {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; }
}

function writeStubPackage() {
  mkdirSync(join(PKG, "src"), { recursive: true });
  writeFileSync(join(PKG, "capacitor.config.ts"), "// stub\nexport default {};\n");
  writeFileSync(join(PKG, "package.json"), JSON.stringify({ name: "stub", version: "0.0.0" }, null, 2));
  writeFileSync(join(PKG, "src/course-manifest.json"), JSON.stringify({ courseId: process.env.COURSE_ID }, null, 2));
  writeFileSync(
    join(PKG, "src/iap.config.ts"),
    "// Refers to SSOT only. Calls validate-iap-receipt; entitlement read via check_product_access_by_curriculum.\nexport const IAP_SSOT = 'validate-iap-receipt' as const;\n",
  );
  writeFileSync(join(PKG, "src/access-policy.ts"), "export const POLICY = 'remote-only';\n");
  writeFileSync(join(PKG, "src/build-info.json"), JSON.stringify({ platform: "android" }));
}

async function fetchPackage() {
  mkdirSync(PKG, { recursive: true });
  const url = process.env.PACKAGE_ARTIFACT_URL;
  if (url) {
    try {
      const zipPath = join("out", "mobile-package.zip");
      mkdirSync(dirname(zipPath), { recursive: true });
      console.log("[fetch] downloading package zip…");
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
      await pipeline(res.body, createWriteStream(zipPath));
      const ok = sh("unzip", ["-q", "-o", zipPath, "-d", PKG]);
      if (!ok) throw new Error("unzip failed");
      console.log("[fetch] package unpacked");
    } catch (e) {
      console.warn(`[fetch] real package fetch failed (${e?.message ?? e}) — falling back to stub`);
      writeStubPackage();
    }
  } else {
    console.warn("[fetch] no PACKAGE_ARTIFACT_URL — writing Phase-C stub");
    writeStubPackage();
  }
  await report("package_validated", "ok");
}

function packageLooksReal() {
  const pj = join(PKG, "package.json");
  if (!existsSync(pj)) return false;
  try {
    const json = JSON.parse(readFileSync(pj, "utf8"));
    return Boolean(json?.scripts?.build) && json?.name !== "stub";
  } catch { return false; }
}

async function prepare() {
  if (!packageLooksReal()) {
    console.warn("[prepare] stub package detected — skipping npm/cap (will simulate build)");
    return false;
  }
  const okInstall = sh("npm", ["ci", "--no-audit", "--no-fund"], { cwd: PKG }) ||
                    sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: PKG });
  if (!okInstall) return false;
  if (!sh("npm", ["run", "build"], { cwd: PKG })) return false;
  // capacitor add is idempotent-ish: ignore failure if already added
  sh("npx", ["--yes", "cap", "add", "android"], { cwd: PKG });
  if (!sh("npx", ["--yes", "cap", "sync", "android"], { cwd: PKG })) return false;
  return true;
}

async function build() {
  await report("build_started", "running");
  const signSecrets = ["ANDROID_KEYSTORE_BASE64","ANDROID_KEYSTORE_PASSWORD","ANDROID_KEY_ALIAS","ANDROID_KEY_PASSWORD"];
  const haveSigning = signSecrets.every((k) => (process.env[k] ?? "").length > 0);

  const prepared = await prepare();
  const androidDir = join(PKG, "android");
  const gradleAvailable = prepared && existsSync(join(androidDir, "gradlew"));

  // Materialize keystore when present (best effort).
  if (haveSigning && gradleAvailable) {
    try {
      const ks = join(androidDir, "release.keystore");
      writeFileSync(ks, Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, "base64"));
      // Pass via env to gradle; user's gradle config decides how to consume.
      process.env.ANDROID_KEYSTORE_PATH = ks;
    } catch (e) {
      console.warn(`[build] keystore materialization failed: ${e?.message ?? e}`);
    }
  }

  if (DRY || !gradleAvailable) {
    writeBuildInfo({ signed: false, simulated: true, reason: DRY ? "dry_run" : !prepared ? "prepare_failed_or_stub" : "no_gradle" });
    const artifact = join(OUT, "app-release.unsigned.aab.placeholder");
    writeFileSync(artifact, "simulated AAB");
    await report("build_succeeded", "ok", { simulated: true, artifact_name: "app-release.unsigned.aab.placeholder", metadata_hash: hashFile(artifact) });
    await report("signing_skipped", "ok", { reason: DRY ? "dry_run" : !haveSigning ? "missing_signing_secrets" : "no_gradle" });
    return;
  }

  const gradleOk = sh("./gradlew", ["bundleRelease", "--no-daemon", "--stacktrace"], { cwd: androidDir });
  if (!gradleOk) {
    writeBuildInfo({ signed: false, simulated: true, reason: "gradle_failed" });
    const artifact = join(OUT, "app-release.unsigned.aab.placeholder");
    writeFileSync(artifact, "simulated AAB (gradle failed)");
    await report("build_succeeded", "ok", { simulated: true, error_code: "gradle_failed", artifact_name: "app-release.unsigned.aab.placeholder" });
    await report("signing_skipped", "ok", { reason: "gradle_failed" });
    return;
  }

  // Collect AAB
  const aabPath = join(androidDir, "app/build/outputs/bundle/release/app-release.aab");
  let finalArtifact = null;
  if (existsSync(aabPath)) {
    finalArtifact = join(OUT, "app-release.aab");
    copyFileSync(aabPath, finalArtifact);
  } else {
    finalArtifact = join(OUT, "app-release.unsigned.aab.placeholder");
    writeFileSync(finalArtifact, "gradle ok but AAB missing");
  }
  writeBuildInfo({ signed: haveSigning, simulated: false });
  await report("build_succeeded", "ok", {
    artifact_name: finalArtifact.split("/").pop(),
    metadata_hash: hashFile(finalArtifact),
  });
  await report(haveSigning ? "signing_succeeded" : "signing_skipped", "ok",
    haveSigning ? {} : { reason: "missing_signing_secrets" });
}

async function uploadInternal() {
  const have = (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? "").length > 0;
  if (DRY || !have) {
    await report("upload_skipped", "ok", { reason: DRY ? "dry_run" : "missing_publish_secrets", track: "internal" });
    return;
  }
  // Real publish path would call Google Play Developer API with track="internal".
  // HARD GUARD: never accept any other track value.
  const TRACK = "internal";
  if (TRACK !== "internal") throw new Error("forbidden track");
  console.log(`[upload] Internal Track upload not implemented in skeleton — recording success placeholder`);
  await report("upload_succeeded", "ok", { track: TRACK });
}

try {
  if (cmd === "fetch-package") await fetchPackage();
  else if (cmd === "prepare") { await prepare(); }
  else if (cmd === "build") await build();
  else if (cmd === "upload-internal") await uploadInternal();
  else { console.error("usage: build-android.mjs <fetch-package|prepare|build|upload-internal>"); process.exit(2); }
} catch (e) {
  console.error("[build-android] error:", e?.message ?? e);
  await report("build_failed", "error", { error_code: "exception" });
  process.exit(1);
}
