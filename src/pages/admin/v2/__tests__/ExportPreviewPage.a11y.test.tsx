/**
 * Accessibility / keyboard regression tests for the Export Preview virtualized
 * file tree (`role="tree"` + aria-activedescendant + treeitem aria-expanded).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualTree } from "@/pages/admin/v2/ExportPreviewPage";
import { buildTree, type ManifestFile } from "@/lib/factory/exportManifest";

// happy-dom has no layout — stub viewport so @tanstack/react-virtual
// materialises real rows we can assert against.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 480,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 640,
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, top: 0, left: 0, bottom: 480, right: 640,
      width: 640, height: 480, toJSON: () => ({}),
    } as DOMRect;
  };
});

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
  it("exposes role=tree with a well-formed aria-activedescendant id", () => {
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
    expect(active).toMatch(/^export-row-\d+$/);
  });

  it("ArrowDown / End / Home update aria-activedescendant from React state", () => {
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
    fireEvent.keyDown(treeEl, { key: "End" });
    const last = treeEl.getAttribute("aria-activedescendant");
    fireEvent.keyDown(treeEl, { key: "Home" });
    const first = treeEl.getAttribute("aria-activedescendant");
    expect(first).not.toBe(last);
    expect(first).toBe("export-row-0");
  });
});

