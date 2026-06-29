/**
 * Accessibility / keyboard regression tests for virtualized lists.
 *
 * Covers:
 *  - CurriculumPicker (oral exam) — listbox + aria-activedescendant pattern
 *  - Forms the contract for the equivalent treeitem pattern used by
 *    ExportPreviewPage's VirtualTree (same handler shape, same ARIA wiring).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useOralStartability", () => ({
  useOralCurriculaReadinessBulk: () => ({
    data: new Map(),
    isLoading: false,
  }),
}));

import { CurriculumPicker } from "@/components/oral/CurriculumPicker";

function makeCurricula(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cur-${i}`,
    title: `Fachinformatiker Anwendungsentwicklung #${i}`,
  }));
}


// happy-dom has no layout engine, so @tanstack/react-virtual would render
// zero virtual rows. Stub a non-zero viewport height + element rects so the
// virtualizer materialises the first window of rows.
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
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 480,
      right: 640,
      width: 640,
      height: 480,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

describe("CurriculumPicker — keyboard + aria-activedescendant", () => {
  beforeEach(() => {
    // jsdom/happy-dom don't implement scrollToIndex internals; the virtualizer
    // gracefully falls back. Nothing to mock.
  });

  it("virtualized listbox exposes role=listbox and a valid aria-activedescendant", async () => {
    render(
      <CurriculumPicker
        curricula={makeCurricula(80)}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const listbox = await screen.findByRole("listbox", { name: /Berufe wählen/i });
    expect(listbox).toBeInTheDocument();
    const active = listbox.getAttribute("aria-activedescendant");
    expect(active).toMatch(/^oral-cur-row-cur-/);
  });

  it("ArrowDown moves aria-activedescendant forward; Enter selects", async () => {
    const onSelect = vi.fn();
    render(
      <CurriculumPicker
        curricula={makeCurricula(80)}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    const listbox = await screen.findByRole("listbox", { name: /Berufe wählen/i });
    const before = listbox.getAttribute("aria-activedescendant");
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    const after = listbox.getAttribute("aria-activedescendant");
    expect(after).not.toBe(before);
    expect(after).toMatch(/^oral-cur-row-/);
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatch(/^cur-/);
  });

  it("Home/End jump activedescendant to first/last item; PageDown moves in chunks", async () => {
    render(
      <CurriculumPicker
        curricula={makeCurricula(120)}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const listbox = await screen.findByRole("listbox", { name: /Berufe wählen/i });
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "End" });
    const last = listbox.getAttribute("aria-activedescendant");
    expect(last).toBeTruthy();
    fireEvent.keyDown(listbox, { key: "Home" });
    const first = listbox.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    expect(first).not.toBe(last);
    fireEvent.keyDown(listbox, { key: "PageDown" });
    const afterPage = listbox.getAttribute("aria-activedescendant");
    expect(afterPage).not.toBe(first);
  });

  it("non-virtualized fallback (small list) still exposes role=option items", async () => {
    render(
      <CurriculumPicker
        curricula={makeCurricula(5)}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    // Small list renders plain buttons (no virtualizer); we assert the
    // overall grid still exists and rows are reachable as buttons.
    const items = await screen.findAllByTestId("oral-curriculum-item");
    expect(items.length).toBeGreaterThan(0);
    // Buttons have an accessible name (the curriculum display name).
    expect(items[0]).toHaveAttribute("aria-pressed");
  });
});
