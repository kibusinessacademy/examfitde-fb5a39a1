import { describe, it, expect } from "vitest";
import { parseHealError } from "../healErrorParser";

describe("parseHealError", () => {
  it("erkennt fehlende Spalte (42703)", () => {
    const r = parseHealError({
      code: "42703",
      message: 'column "lease_expires_at" does not exist',
    });
    expect(r.kind).toBe("schema_missing_column");
    expect(r.title).toMatch(/Spalte fehlt/);
  });

  it("erkennt fehlende Funktion (42883)", () => {
    const r = parseHealError({
      code: "42883",
      message: "function admin_xyz(uuid) does not exist",
    });
    expect(r.kind).toBe("schema_missing_function");
  });

  it("erkennt fehlende Relation (42P01)", () => {
    const r = parseHealError({
      code: "42P01",
      message: 'relation "public.foo" does not exist',
    });
    expect(r.kind).toBe("schema_missing_relation");
  });

  it("erkennt permission denied", () => {
    const r = parseHealError({ code: "42501", message: "permission denied for function" });
    expect(r.kind).toBe("permission_denied");
  });

  it("erkennt RPC-Result mit errors > 0", () => {
    const r = parseHealError({
      result: {
        errors: 2,
        processed: 0,
        details: [
          { action: "reset_to_pending", reason: "stale_lock_missing", error: "x" },
          { action: "reset_to_pending", reason: "y" },
        ],
      },
    });
    expect(r.kind).toBe("rpc_returned_errors");
    expect(r.details?.length).toBe(2);
  });

  it("fällt auf 'unknown' zurück", () => {
    const r = parseHealError({ message: "irgendwas anderes" });
    expect(r.kind).toBe("unknown");
    expect(r.description).toMatch(/irgendwas/);
  });
});
