import { describe, expect, it } from "vitest";
import {
  buildCurriculumIndex,
  filterCurricula,
} from "@/lib/curriculumDisplay";

/**
 * Performance regression guard for the Curriculum Picker.
 * Numbers are conservative (CI-safe). They protect against accidental
 * O(n²) regressions in dedupe / filter / sort paths.
 */

function makeRows(n: number) {
  const seeds = [
    "Industriekaufmann",
    "Bankkaufmann",
    "Fachinformatiker Anwendungsentwicklung",
    "Fachinformatiker Systemintegration",
    "Kaufmann für Büromanagement",
    "Medizinische Fachangestellte",
    "Steuerfachangestellte",
    "Mechatroniker",
    "Elektroniker für Betriebstechnik",
    "Pflegefachfrau",
  ];
  const rows: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < n; i++) {
    const seed = seeds[i % seeds.length];
    const prefix = i % 3 === 0 ? "Rahmenlehrplan " : "";
    rows.push({ id: `cur-${i}`, title: `${prefix}${seed} #${i}` });
  }
  return rows;
}

describe("curriculumDisplay perf guard", () => {
  it("buildCurriculumIndex handles 3000 entries under 200ms", () => {
    const rows = makeRows(3000);
    const t0 = performance.now();
    const idx = buildCurriculumIndex(rows);
    const dt = performance.now() - t0;
    expect(idx.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(200);
  });

  it("filterCurricula handles 3000 entries under 120ms (with query)", () => {
    const idx = buildCurriculumIndex(makeRows(3000));
    const t0 = performance.now();
    const out = filterCurricula(idx, { query: "kauf", category: "all", sort: "relevance" });
    const dt = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(120);
  });

  it("popularity sort over 5000 entries under 150ms", () => {
    const idx = buildCurriculumIndex(makeRows(5000));
    const t0 = performance.now();
    const out = filterCurricula(idx, { sort: "popularity" });
    const dt = performance.now() - t0;
    expect(out.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(150);
  });
});
