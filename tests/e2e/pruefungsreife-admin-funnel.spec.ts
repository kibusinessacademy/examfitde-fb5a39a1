/**
 * E2E — Prüfungsreife Admin-Funnel-Card.
 *
 * Deckt:
 *  1. Ungültiger ?question_source=invalid → Toast + Badge sichtbar, UI lädt ohne Crash.
 *  2. „Segmente"-CSV-Export liefert Datei mit allen drei Segmenten (all/blueprint/generic).
 *
 * Admin-Auth-Voraussetzung: Test überspringt sich weich, wenn /admin/growth
 * nicht erreichbar ist (Login-Redirect oder fehlende Admin-Rolle in der
 * jeweiligen Preview).
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const TARGET = process.env.TARGET_URL || "https://examfitde.lovable.app";

async function gotoFunnel(page: any, query: string) {
  await page.goto(`${TARGET}/admin/growth${query}`, { waitUntil: "networkidle" });
  // Card muss da sein, sonst sind wir nicht eingeloggt / nicht admin
  const card = page.getByText(/Prüfungsreife-Funnel/i);
  if (!(await card.isVisible({ timeout: 5_000 }).catch(() => false))) {
    test.skip(true, "Admin-Funnel-Card nicht erreichbar (Login/Role) in dieser Preview");
  }
}

test("ungültiger question_source URL-Param: Badge + Toast sichtbar, kein Crash", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await gotoFunnel(page, "?question_source=invalid");

  // Badge muss erscheinen
  await expect(page.getByTestId("source-invalid-badge")).toBeVisible({ timeout: 10_000 });

  // Toast (sonner) — Text enthält "Ungültiger Filter"
  await expect(page.getByText(/Ungültiger Filter/i)).toBeVisible({ timeout: 5_000 });

  // Source-Toggle aktiv und auf "Alle" zurückgesetzt
  await expect(page.getByTestId("source-toggle-all")).toHaveAttribute("data-active", "true");

  // KPI-Grid lädt → kein Crash
  await expect(page.getByText(/Starts/i).first()).toBeVisible();

  expect(errors, `pageerror events: ${errors.join("\n")}`).toHaveLength(0);
});

test("Segmente-CSV-Export enthält alle drei Segmente", async ({ page }) => {
  await gotoFunnel(page, "");

  const exportBtn = page.getByTestId("export-segments-csv");
  await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  // Warten bis Daten geladen → Button enabled
  await expect(exportBtn).toBeEnabled({ timeout: 15_000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    exportBtn.click(),
  ]);

  const tmp = path.join("/tmp", `seg-${Date.now()}.csv`);
  await download.saveAs(tmp);
  const csv = fs.readFileSync(tmp, "utf8");

  // Header muss "segment" enthalten
  expect(csv.split("\n")[0]).toMatch(/segment/);
  // Drei Segment-Werte
  expect(csv).toMatch(/(^|;|")all(;|")/m);
  expect(csv).toMatch(/(^|;|")blueprint(;|")/m);
  expect(csv).toMatch(/(^|;|")generic(;|")/m);

  fs.unlinkSync(tmp);
});
