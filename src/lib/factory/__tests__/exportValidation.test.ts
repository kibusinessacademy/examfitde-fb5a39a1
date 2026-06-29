import { describe, expect, it } from "vitest";
import type { ManifestFile } from "@/lib/factory/exportManifest";
import {
  autoIncludeCriticalPaths,
  validateExportCompleteness,
} from "@/lib/factory/exportValidation";

const mk = (path: string, kind: ManifestFile["kind"] = "binary"): ManifestFile => ({
  path,
  mime: "application/octet-stream",
  size: 1024,
  kind,
});

const baseManifest = (): ManifestFile[] => [
  mk("manifest.json", "text"),
  mk("README.md", "text"),
  mk("course_modules/m1/lesson.md", "text"),
  mk("course_modules/m1/quiz.json", "text"),
  mk("assets/cover.jpg"),
  mk("assets/handout.pdf"),
  mk("visualizations/flow.svg", "text"),
  mk("oral_exam/blueprint.json", "text"),
  mk("oral_exam/README.md", "text"),
];

describe("validateExportCompleteness", () => {
  it("passes when every file is selected", () => {
    const files = baseManifest();
    const sel = new Set(files.map((f) => f.path));
    const r = validateExportCompleteness(files, sel);
    expect(r.ok).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.missingPaths).toEqual([]);
  });

  it("flags missing assets/visualizations as auto-fixable", () => {
    const files = baseManifest();
    const sel = new Set(
      files.filter((f) => !f.path.startsWith("assets/")).map((f) => f.path),
    );
    const r = validateExportCompleteness(files, sel);
    expect(r.ok).toBe(false);
    expect(r.blocking).toBe(true); // assets is critical
    expect(r.missingPaths).toEqual(
      expect.arrayContaining(["assets/cover.jpg", "assets/handout.pdf"]),
    );
  });

  it("blocks the download when a critical file is blocked at manifest level", () => {
    const files = baseManifest();
    files[2] = { ...files[2], kind: "blocked", blocked_reason: "policy" };
    const sel = new Set(files.map((f) => f.path));
    const r = validateExportCompleteness(files, sel);
    expect(r.blocking).toBe(true);
    expect(r.blockedCriticalPaths).toContain("course_modules/m1/lesson.md");
  });

  it("does NOT block on missing oral_exam (non-critical) but does on course_modules", () => {
    const files = baseManifest();
    const sel = new Set(
      files
        .filter((f) => !f.path.startsWith("oral_exam/"))
        .map((f) => f.path),
    );
    const r = validateExportCompleteness(files, sel);
    expect(r.blocking).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.missingPaths).toEqual(
      expect.arrayContaining(["oral_exam/blueprint.json", "oral_exam/README.md"]),
    );
  });
});

describe("autoIncludeCriticalPaths", () => {
  it("re-adds missing critical files without touching blocked entries", () => {
    const files = baseManifest();
    files[5] = { ...files[5], kind: "blocked", blocked_reason: "size" };
    const sel = new Set<string>(["manifest.json"]);
    const next = autoIncludeCriticalPaths(files, sel);
    expect(next.has("course_modules/m1/lesson.md")).toBe(true);
    expect(next.has("assets/cover.jpg")).toBe(true);
    expect(next.has("assets/handout.pdf")).toBe(false); // blocked stays out
  });

  it("is idempotent", () => {
    const files = baseManifest();
    const first = autoIncludeCriticalPaths(files, new Set());
    const second = autoIncludeCriticalPaths(files, first);
    expect([...first].sort()).toEqual([...second].sort());
  });
});

describe("validateExportCompleteness — perf guard", () => {
  it("scales to 5000 manifest entries under 250ms", () => {
    const files: ManifestFile[] = [];
    for (let i = 0; i < 1500; i++) files.push(mk(`course_modules/m${i}/lesson.md`, "text"));
    for (let i = 0; i < 1500; i++) files.push(mk(`assets/img-${i}.jpg`));
    for (let i = 0; i < 1000; i++) files.push(mk(`visualizations/v-${i}.svg`, "text"));
    for (let i = 0; i < 1000; i++) files.push(mk(`oral_exam/q-${i}.json`, "text"));
    files.push(mk("manifest.json", "text"));
    const sel = new Set(files.map((f) => f.path));
    const t0 = performance.now();
    const r = validateExportCompleteness(files, sel);
    const dt = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(dt).toBeLessThan(250);
  });
});
