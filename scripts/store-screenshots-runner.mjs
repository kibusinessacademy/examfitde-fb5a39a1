#!/usr/bin/env node
/**
 * store-screenshots-runner
 *
 * Picks one queued run from store_release_screenshot_runs, renders every
 * (device_profile, route) combo via Playwright, uploads PNGs to the
 * 'store-screenshots' storage bucket, and updates store_release_screenshots rows.
 *
 * Safe to no-op when any required env var is missing.
 */

import { chromium, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  STORE_SHOTS_TARGET_URL,
  STORE_SHOTS_E2E_EMAIL,
  STORE_SHOTS_E2E_PASSWORD,
  RUN_ID_INPUT,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STORE_SHOTS_TARGET_URL) {
  console.warn("[store-screenshots] Missing env. Exiting cleanly.");
  process.exit(0);
}

const DEVICE_MAP = {
  iphone_6_7: { ...devices["iPhone 14 Pro Max"] },
  iphone_5_5: { ...devices["iPhone 8 Plus"] },
  ipad_12_9: { ...devices["iPad Pro 11"] },
  android_phone: { ...devices["Pixel 7"] },
  android_tablet_7: { viewport: { width: 1024, height: 600 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile" },
  android_tablet_10: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile" },
};

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function pickRun() {
  if (RUN_ID_INPUT) {
    const { data } = await sb.from("store_release_screenshot_runs").select("*").eq("id", RUN_ID_INPUT).maybeSingle();
    return data;
  }
  const { data } = await sb
    .from("store_release_screenshot_runs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

async function ensureBucket() {
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === "store-screenshots")) {
    await sb.storage.createBucket("store-screenshots", { public: true });
  }
}

async function maybeLogin(page) {
  if (!STORE_SHOTS_E2E_EMAIL || !STORE_SHOTS_E2E_PASSWORD) return;
  try {
    await page.goto(`${STORE_SHOTS_TARGET_URL}/auth`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.fill('input[type="email"]', STORE_SHOTS_E2E_EMAIL);
    await page.fill('input[type="password"]', STORE_SHOTS_E2E_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  } catch (e) {
    console.warn("[store-screenshots] login skipped:", e?.message);
  }
}

async function main() {
  const run = await pickRun();
  if (!run) { console.log("[store-screenshots] No queued runs."); return; }

  console.log(`[store-screenshots] Run ${run.id} course=${run.course_id} platform=${run.platform}`);
  await sb.from("store_release_screenshot_runs").update({ status: "running", github_run_id: process.env.GITHUB_RUN_ID || null }).eq("id", run.id);
  await ensureBucket();

  const baseDir = join("out", "store-screenshots", run.id);
  await mkdir(baseDir, { recursive: true });

  const browser = await chromium.launch();
  let failed = 0, ok = 0;

  try {
    for (const profile of run.device_profiles ?? []) {
      const deviceCfg = DEVICE_MAP[profile];
      if (!deviceCfg) { console.warn(`unknown profile ${profile}`); continue; }
      const context = await browser.newContext(deviceCfg);
      const page = await context.newPage();
      await maybeLogin(page);

      for (const route of run.routes ?? []) {
        const safeRoute = route.replace(/[^a-z0-9]+/gi, "_") || "root";
        const filename = `${profile}_${safeRoute}.png`;
        const localPath = join(baseDir, filename);
        const storagePath = `${run.course_id}/${run.platform}/${run.id}/${filename}`;
        try {
          await page.goto(`${STORE_SHOTS_TARGET_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(800);
          const buf = await page.screenshot({ type: "png", fullPage: false });
          await writeFile(localPath, buf);
          const { error: upErr } = await sb.storage.from("store-screenshots").upload(storagePath, buf, { contentType: "image/png", upsert: true });
          if (upErr) throw upErr;
          const { data: pub } = sb.storage.from("store-screenshots").getPublicUrl(storagePath);
          await sb.from("store_release_screenshots")
            .update({
              status: "ready",
              storage_bucket: "store-screenshots",
              storage_path: storagePath,
              public_url: pub.publicUrl,
              width: deviceCfg.viewport?.width ?? null,
              height: deviceCfg.viewport?.height ?? null,
              generated_at: new Date().toISOString(),
              error: null,
            })
            .eq("run_id", run.id).eq("device_profile", profile).eq("route", route);
          ok++;
        } catch (e) {
          failed++;
          await sb.from("store_release_screenshots")
            .update({ status: "failed", error: String(e?.message ?? e) })
            .eq("run_id", run.id).eq("device_profile", profile).eq("route", route);
          console.error(`[store-screenshots] FAIL ${profile} ${route}:`, e?.message);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  await sb.from("store_release_screenshot_runs")
    .update({ status: failed === 0 ? "completed" : "failed", notes: `ok=${ok} failed=${failed}` })
    .eq("id", run.id);
  console.log(`[store-screenshots] done ok=${ok} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
