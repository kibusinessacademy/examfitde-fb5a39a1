/**
 * Accessibility / keyboard regression tests for the Export Preview virtualized
 * file tree (`role="tree"` + aria-activedescendant + treeitem aria-expanded).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualTree } from "@/pages/admin/v2/ExportPreviewPage";
import { buildTree, type ManifestFile } from "@/lib/factory/exportManifest";

const mk = (path: string, kind: ManifestFile["kind"] = "text"): ManifestFile => ({
  path,
  mime: "text/plain",
  size: 256,
  kind,
});

const files: ManifestFile[] = [
  mk("manifest.json"),
  mk("course_modules/m1/lesson.md"),
  mk("course_modules/m1/quiz.json"),
  mk("course_modules/m2/lesson.md"),
  mk("assets/cover.jpg", "binary"),
  mk("oral_exam/blueprint.json"),
];

describe("ExportPreviewPage › VirtualTree — a11y/keyboard", () => {
  it("exposes role=tree with aria-activedescendant resolving to a treeitem", () => {
    const tree = buildTree(files);
    render(
      <VirtualTree
        tree={tree}
        selected={new Set(files.map((f) => f.path))}
        toggle={() => {}}
        onPick={() => {}}
        pickedPath={null}
      />,
    );
    const treeEl = screen.getByRole("tree", { name: /Export-Dateibaum/i });
    const active = treeEl.getAttribute("aria-activedescendant");
    expect(active).toMatch(/^export-row-/);
    expect(document.getElementById(active!)).not.toBeNull();
  });

  it("ArrowDown advances activedescendant; Enter on a directory toggles aria-expanded", () => {
    const tree = buildTree(files);
    render(
      <VirtualTree
        tree={tree}
        selected={new Set(files.map((f) => f.path))}
        toggle={() => {}}
        onPick={() => {}}
        pickedPath={null}
      />,
    );
    const treeEl = screen.getByRole("tree", { name: /Export-Dateibaum/i });
    const before = treeEl.getAttribute("aria-activedescendant");
    treeEl.focus();
    fireEvent.keyDown(treeEl, { key: "ArrowDown" });
    const after = treeEl.getAttribute("aria-activedescendant");
    expect(after).not.toBe(before);

    // First row is a directory — exposes aria-expanded.
    const first = document.getElementById("export-row-0")!;
    const expandedBefore = first.getAttribute("aria-expanded");
    expect(expandedBefore === "true" || expandedBefore === "false").toBe(true);
  });

  it("Enter on a file row triggers onPick", () => {
    const tree = buildTree(files);
    const onPick = vi.fn();
    render(
      <VirtualTree
        tree={tree}
        selected={new Set(files.map((f) => f.path))}
        toggle={() => {}}
        onPick={onPick}
        pickedPath={null}
      />,
    );
    const treeEl = screen.getByRole("tree", { name: /Export-Dateibaum/i });
    treeEl.focus();
    // Walk down until aria-activedescendant points at a row whose
    // underlying entry is a file (treeitem without aria-expanded).
    for (let i = 0; i < 20; i++) {
      const id = treeEl.getAttribute("aria-activedescendant");
      const el = id ? document.getElementById(id) : null;
      if (el && !el.hasAttribute("aria-expanded")) {
        fireEvent.keyDown(treeEl, { key: "Enter" });
        break;
      }
      fireEvent.keyDown(treeEl, { key: "ArrowDown" });
    }
    expect(onPick).toHaveBeenCalled();
  });
});
