import { describe, expect, it } from "vitest";
import type { ManifestFile } from "@/lib/factory/exportManifest";
import {
  autoIncludeCategoryPaths,
  toCopyableSummary,
  validateExportCompleteness,
} from "@/lib/factory/exportValidation";

const mk = (path: string, kind: ManifestFile["kind"] = "binary"): ManifestFile => ({
  path,
  mime: "application/octet-stream",
  size: 512,
  kind,
});

const manifest = (): ManifestFile[] => [
  mk("manifest.json", "text"),
  mk("course_modules/m1/lesson.md", "text"),
  mk("assets/cover.jpg"),
  mk("assets/handout.pdf"),
  mk("visualizations/flow.svg", "text"),
  mk("oral_exam/blueprint.json", "text"),
];

describe("autoIncludeCategoryPaths", () => {
  it("re-adds only the requested category", () => {
    const files = manifest();
    const sel = new Set<string>(["manifest.json"]);
    const next = autoIncludeCategoryPaths(files, sel, "assets");
    expect(next.has("assets/cover.jpg")).toBe(true);
    expect(next.has("assets/handout.pdf")).toBe(true);
    expect(next.has("course_modules/m1/lesson.md")).toBe(false);
    expect(next.has("oral_exam/blueprint.json")).toBe(false);
  });

  it("never re-adds blocked files", () => {
    const files = manifest();
    files[2] = { ...files[2], kind: "blocked", blocked_reason: "policy" };
    const next = autoIncludeCategoryPaths(files, new Set(), "assets");
    expect(next.has("assets/cover.jpg")).toBe(false);
    expect(next.has("assets/handout.pdf")).toBe(true);
  });

  it("no-ops for unknown category", () => {
    const files = manifest();
    const sel = new Set<string>(["manifest.json"]);
    // @ts-expect-error — runtime safety
    const next = autoIncludeCategoryPaths(files, sel, "unknown");
    expect([...next]).toEqual(["manifest.json"]);
  });
});

describe("toCopyableSummary", () => {
  it("renders OK state cleanly", () => {
    const files = manifest();
    const sel = new Set(files.map((f) => f.path));
    const md = toCopyableSummary(validateExportCompleteness(files, sel));
    expect(md).toMatch(/OK ✅/);
    expect(md).toMatch(/Kursmodule/);
  });

  it("lists every missing path under its category", () => {
    const files = manifest();
    const sel = new Set(files.filter((f) => !f.path.startsWith("assets/")).map((f) => f.path));
    const md = toCopyableSummary(validateExportCompleteness(files, sel));
    expect(md).toMatch(/⚠️|❌/);
    expect(md).toContain("assets/cover.jpg");
    expect(md).toContain("assets/handout.pdf");
  });

  it("truncates very long path lists with a counter", () => {
    const files: ManifestFile[] = [mk("manifest.json", "text")];
    for (let i = 0; i < 80; i++) files.push(mk(`assets/img-${i}.jpg`));
    const sel = new Set<string>(["manifest.json"]);
    const md = toCopyableSummary(validateExportCompleteness(files, sel));
    expect(md).toMatch(/\+30 weitere/);
  });
});
