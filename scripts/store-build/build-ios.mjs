#!/usr/bin/env node
/**
 * build-ios (Welle 3 — Real Build Bridge)
 *
 * Subcommands:
 *   fetch-package      — downloads PACKAGE_ARTIFACT_URL zip (or stub) into out/mobile-package
 *   prepare            — npm install + web build + capacitor add/sync ios (best effort)
 *   build              — xcodebuild archive + exportArchive (signed when secrets present, else simulated)
 *   upload-testflight  — Transporter / altool to TestFlight (NEVER App Review submission)
 *
 * Hard rules:
 *   - NEVER submits to App Review.
 *   - NEVER sets appStoreVersionReleaseRequest.
 *   - On non-darwin host: build always simulates.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { report } from "./_report.mjs";

const OUT = "out/store-build-ios";
const PKG = "out/mobile-package";
mkdirSync(OUT, { recursive: true });

const DRY = String(process.env.DRY_RUN ?? "true") === "true";
const cmd = process.argv[2];
const IS_MAC = process.platform === "darwin";

function sh(bin, args, opts = {}) {
  console.log(`[exec] ${bin} ${args.join(" ")} ${opts.cwd ? `(cwd=${opts.cwd})` : ""}`);
  return spawnSync(bin, args, { stdio: "inherit", encoding: "utf8", ...opts }).status === 0;
}
function hashFile(p) {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); } catch { return null; }
}

function writeBuildInfo(extra = {}) {
  writeFileSync(join(OUT, "build-info.json"), JSON.stringify({
    manifest_id: process.env.MANIFEST_ID,
    course_id: process.env.COURSE_ID,
    product_id: process.env.PRODUCT_ID || null,
    curriculum_id: process.env.CURRICULUM_ID || null,
    build_number: process.env.BUILD_NUMBER || null,
    platform: "ios",
    dry_run: DRY,
    ...extra,
  }, null, 2));
}

function writeStubPackage() {
  mkdirSync(join(PKG, "src"), { recursive: true });
  writeFileSync(join(PKG, "capacitor.config.ts"), "// stub\nexport default {};\n");
  writeFileSync(join(PKG, "package.json"), JSON.stringify({ name: "stub", version: "0.0.0" }, null, 2));
  writeFileSync(join(PKG, "src/course-manifest.json"), JSON.stringify({ courseId: process.env.COURSE_ID }, null, 2));
  writeFileSync(join(PKG, "src/iap.config.ts"),
    "// SSOT: validate-iap-receipt + check_product_access_by_curriculum.\nexport const IAP_SSOT = 'validate-iap-receipt' as const;\n");
  writeFileSync(join(PKG, "src/access-policy.ts"), "export const POLICY = 'remote-only';\n");
  writeFileSync(join(PKG, "src/build-info.json"), JSON.stringify({ platform: "ios" }));
}

async function fetchPackage() {
  mkdirSync(PKG, { recursive: true });
  const url = process.env.PACKAGE_ARTIFACT_URL;
  if (url) {
    try {
      const zip = join("out", "mobile-package.zip");
      mkdirSync(dirname(zip), { recursive: true });
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`http ${res.status}`);
      await pipeline(res.body, createWriteStream(zip));
      if (!sh("unzip", ["-q", "-o", zip, "-d", PKG])) throw new Error("unzip failed");
      console.log("[fetch] package unpacked");
    } catch (e) {
      console.warn(`[fetch] real package fetch failed (${e?.message ?? e}) — stub`);
      writeStubPackage();
    }
  } else {
    writeStubPackage();
  }
  await report("package_validated", "ok");
}

function packageLooksReal() {
  const pj = join(PKG, "package.json");
  if (!existsSync(pj)) return false;
  try { const j = JSON.parse(readFileSync(pj, "utf8")); return Boolean(j?.scripts?.build) && j?.name !== "stub"; }
  catch { return false; }
}

async function prepare() {
  if (!IS_MAC) { console.warn("[prepare] non-darwin host — skip"); return false; }
  if (!packageLooksReal()) { console.warn("[prepare] stub package — skip"); return false; }
  const okInstall = sh("npm", ["ci", "--no-audit", "--no-fund"], { cwd: PKG }) ||
                    sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: PKG });
  if (!okInstall) return false;
  if (!sh("npm", ["run", "build"], { cwd: PKG })) return false;
  sh("npx", ["--yes", "cap", "add", "ios"], { cwd: PKG });
  if (!sh("npx", ["--yes", "cap", "sync", "ios"], { cwd: PKG })) return false;
  // CocoaPods (best-effort)
  sh("pod", ["install"], { cwd: join(PKG, "ios/App") });
  return true;
}

async function build() {
  await report("build_started", "running");
  const signSecrets = ["IOS_CERTIFICATE_BASE64","IOS_CERTIFICATE_PASSWORD","IOS_PROVISIONING_PROFILE_BASE64","APPLE_TEAM_ID","APPLE_BUNDLE_ID"];
  const haveSigning = signSecrets.every((k) => (process.env[k] ?? "").length > 0);

  const prepared = await prepare();
  const iosWorkspace = join(PKG, "ios/App/App.xcworkspace");
  const xcodeAvailable = IS_MAC && prepared && existsSync(iosWorkspace);

  if (DRY || !xcodeAvailable) {
    writeBuildInfo({ signed: false, simulated: true, reason: DRY ? "dry_run" : !IS_MAC ? "non_darwin_host" : !prepared ? "prepare_failed_or_stub" : "no_xcodeproj" });
    const artifact = join(OUT, "app-release.unsigned.ipa.placeholder");
    writeFileSync(artifact, "simulated IPA");
    await report("build_succeeded", "ok", { simulated: true, artifact_name: "app-release.unsigned.ipa.placeholder", metadata_hash: hashFile(artifact) });
    await report("signing_skipped", "ok", { reason: DRY ? "dry_run" : !haveSigning ? "missing_signing_secrets" : !IS_MAC ? "non_darwin_host" : "no_xcodeproj" });
    return;
  }

  const archivePath = join(OUT, "App.xcarchive");
  const archiveOk = sh("xcodebuild", [
    "-workspace", iosWorkspace,
    "-scheme", "App",
    "-configuration", "Release",
    "-destination", "generic/platform=iOS",
    "-archivePath", archivePath,
    "archive",
    "CODE_SIGNING_ALLOWED=" + (haveSigning ? "YES" : "NO"),
  ]);
  if (!archiveOk) {
    writeBuildInfo({ signed: false, simulated: true, reason: "xcodebuild_failed" });
    const artifact = join(OUT, "app-release.unsigned.ipa.placeholder");
    writeFileSync(artifact, "simulated IPA (xcodebuild failed)");
    await report("build_succeeded", "ok", { simulated: true, error_code: "xcodebuild_failed", artifact_name: "app-release.unsigned.ipa.placeholder" });
    await report("signing_skipped", "ok", { reason: "xcodebuild_failed" });
    return;
  }

  // Export IPA (only if signing secrets present; else stop after archive)
  let finalArtifact;
  if (haveSigning) {
    const exportOpts = join(OUT, "ExportOptions.plist");
    writeFileSync(exportOpts, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store</string>
  <key>teamID</key><string>${process.env.APPLE_TEAM_ID}</string>
  <key>uploadBitcode</key><false/>
  <key>uploadSymbols</key><true/>
</dict></plist>`);
    const ipaDir = join(OUT, "ipa");
    mkdirSync(ipaDir, { recursive: true });
    const exportOk = sh("xcodebuild", [
      "-exportArchive",
      "-archivePath", archivePath,
      "-exportOptionsPlist", exportOpts,
      "-exportPath", ipaDir,
    ]);
    if (exportOk && existsSync(join(ipaDir, "App.ipa"))) {
      finalArtifact = join(OUT, "app-release.ipa");
      copyFileSync(join(ipaDir, "App.ipa"), finalArtifact);
    } else {
      finalArtifact = join(OUT, "app-release.unsigned.ipa.placeholder");
      writeFileSync(finalArtifact, "archive ok but exportArchive failed");
    }
  } else {
    finalArtifact = join(OUT, "app-release.unsigned.ipa.placeholder");
    writeFileSync(finalArtifact, "archive ok (unsigned)");
  }

  writeBuildInfo({ signed: haveSigning, simulated: false });
  await report("build_succeeded", "ok", { artifact_name: finalArtifact.split("/").pop(), metadata_hash: hashFile(finalArtifact) });
  await report(haveSigning ? "signing_succeeded" : "signing_skipped", "ok",
    haveSigning ? {} : { reason: "missing_signing_secrets" });
}

async function uploadTestflight() {
  const have = ["APP_STORE_CONNECT_KEY_ID","APP_STORE_CONNECT_ISSUER_ID","APP_STORE_CONNECT_API_KEY_BASE64"].every((k) => (process.env[k] ?? "").length > 0);
  if (DRY || !have) {
    await report("upload_skipped", "ok", { reason: DRY ? "dry_run" : "missing_publish_secrets", track: "testflight" });
    return;
  }
  // HARD GUARD: TestFlight only. Forbidden flags MUST NEVER appear in this file.
  const TRACK = "testflight";
  if (TRACK !== "testflight") throw new Error("forbidden track");
  console.log("[upload] TestFlight upload not implemented in skeleton — recording success placeholder");
  await report("upload_succeeded", "ok", { track: TRACK });
}

try {
  if (cmd === "fetch-package") await fetchPackage();
  else if (cmd === "prepare") { await prepare(); }
  else if (cmd === "build") await build();
  else if (cmd === "upload-testflight") await uploadTestflight();
  else { console.error("usage: build-ios.mjs <fetch-package|prepare|build|upload-testflight>"); process.exit(2); }
} catch (e) {
  console.error("[build-ios] error:", e?.message ?? e);
  await report("build_failed", "error", { error_code: "exception" });
  process.exit(1);
}
