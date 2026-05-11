/**
 * Contract test — seo-internal-linker result shape (Phase 2 / Growth Wave)
 *
 * The content-runner EMPTY_RESULT classifier requires one of:
 *   - result.ok === true
 *   - result.generated > 0
 *   - result.batch_complete === true
 *
 * Without these fields, every successful linker run was DLQ'd as
 * EMPTY_RESULT (root cause of the 26-attempt loop fixed by this wave).
 *
 * This test pins the response shape. It does NOT invoke the deployed
 * function (no service-role key required); it asserts on the literal
 * source so a future regression that drops `ok`/`generated`/`batch_complete`
 * fails CI before deploy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/seo-internal-linker/index.ts"),
  "utf8",
);

describe("seo-internal-linker — result shape contract", () => {
  it("returns ok=true (content-runner success classifier)", () => {
    expect(SRC).toMatch(/ok:\s*true/);
  });

  it("returns generated count (links added across docs)", () => {
    expect(SRC).toMatch(/generated:\s*totalLinks/);
  });

  it("returns batch_complete=true (finite snapshot, no further pages)", () => {
    expect(SRC).toMatch(/batch_complete:\s*true/);
  });

  it("returns remaining=0 (signals tail to runner)", () => {
    expect(SRC).toMatch(/remaining:\s*0/);
  });

  it("does NOT use legacy success:true shape (would EMPTY_RESULT-loop)", () => {
    // Allow `success:` only if it's not the top-level response field anymore.
    // The fix replaced `success: true` with `ok: true`.
    const successAtTopLevel = /JSON\.stringify\(\{\s*success:\s*true/.test(SRC);
    expect(successAtTopLevel).toBe(false);
  });
});
