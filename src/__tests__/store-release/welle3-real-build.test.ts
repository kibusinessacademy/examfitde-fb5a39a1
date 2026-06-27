/**
 * Welle 3 — Real Build Bridge contract tests.
 *
 * Ensures the build scripts contain real-build wiring (unzip, npm build,
 * capacitor sync, gradle bundleRelease, xcodebuild archive) AND keep the
 * hard limits (no production track, no App Review submission, TestFlight only,
 * Internal Track only, simulation fallback always available).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const r = (p: string) => readFileSync(join(ROOT, p), "utf8");

const BUILD_ANDROID = "scripts/store-build/build-android.mjs";
const BUILD_IOS = "scripts/store-build/build-ios.mjs";
const ANDROID_WF = ".github/workflows/store-build-android.yml";

describe("Welle 3 — Android real build bridge", () => {
  const s = r(BUILD_ANDROID);
  it("unzips PACKAGE_ARTIFACT_URL into out/mobile-package", () => {
    expect(s).toMatch(/PACKAGE_ARTIFACT_URL/);
    expect(s).toMatch(/unzip/);
  });
  it("runs npm build + capacitor sync android", () => {
    expect(s).toMatch(/npm.*run.*build|"build"/);
    expect(s).toMatch(/cap.*sync.*android|"sync".*"android"/);
  });
  it("invokes gradle bundleRelease", () => {
    expect(s).toMatch(/gradlew/);
    expect(s).toMatch(/bundleRelease/);
  });
  it("falls back to simulation when prerequisites missing", () => {
    expect(s).toMatch(/simulated:\s*true/);
    expect(s).toMatch(/no_gradle|prepare_failed_or_stub|gradle_failed/);
  });
  it("hard-blocks any non-internal track", () => {
    expect(s).not.toMatch(/track:\s*["']production["']/);
    expect(s).toMatch(/TRACK\s*=\s*["']internal["']/);
  });
  it("workflow installs JDK 17 + Android SDK", () => {
    const wf = r(ANDROID_WF);
    expect(wf).toMatch(/setup-java/);
    expect(wf).toMatch(/java-version:\s*"17"/);
    expect(wf).toMatch(/setup-android/);
  });
});

describe("Welle 3 — iOS real build bridge", () => {
  const s = r(BUILD_IOS);
  it("unzips PACKAGE_ARTIFACT_URL", () => {
    expect(s).toMatch(/PACKAGE_ARTIFACT_URL/);
    expect(s).toMatch(/unzip/);
  });
  it("runs npm build + capacitor sync ios", () => {
    expect(s).toMatch(/npm.*run.*build|"build"/);
    expect(s).toMatch(/cap.*sync.*ios|"sync".*"ios"/);
  });
  it("invokes xcodebuild archive + exportArchive", () => {
    expect(s).toMatch(/xcodebuild/);
    expect(s).toMatch(/-archivePath/);
    expect(s).toMatch(/-exportArchive/);
  });
  it("forces simulation on non-darwin hosts", () => {
    expect(s).toMatch(/IS_MAC|process\.platform\s*===\s*["']darwin["']/);
    expect(s).toMatch(/non_darwin_host/);
  });
  it("never submits to App Review", () => {
    expect(s).not.toMatch(/submitForReview/i);
    expect(s).not.toMatch(/appStoreVersionReleaseRequest/i);
    expect(s).toMatch(/TRACK\s*=\s*["']testflight["']/);
  });
  it("export plist uses method=app-store only (TestFlight path)", () => {
    expect(s).toMatch(/<string>app-store<\/string>/);
  });
});
