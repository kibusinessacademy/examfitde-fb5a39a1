/**
 * Smoke-Tests für die Repair-Strategie-RPCs.
 *
 * Ziel: Schema-Regressionen (fehlende Spalten/Funktionen, falsche Signaturen)
 * sofort fangen — wir haben in der Vergangenheit zweimal Drift erlebt
 * (`lease_expires_at`, `eq.package_id`), der erst durch Fehlversuche im Cockpit
 * sichtbar wurde.
 *
 * Strategie:
 *  1. RPC mit zufälliger UUID aufrufen (Paket existiert nicht → Funktion muss
 *     dennoch sauber antworten, NICHT mit 42703/42883/42P01 sterben).
 *  2. Postgres-Fehlercodes für „undefined column / function / table" sind harte
 *     Regressionen → Test schlägt fehl.
 *  3. „package not found / no permission" sind erlaubte Antworten — die
 *     Funktion existiert und das Schema passt.
 *
 * Hinweis: Tests benötigen die Standard ENV vars
 * VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY. Sind sie nicht gesetzt,
 * werden die Tests übersprungen statt false-positive zu failen.
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const RANDOM_UUID = "00000000-0000-4000-8000-000000000000";

const SCHEMA_REGRESSION_CODES = new Set([
  "42703", // undefined column
  "42883", // undefined function
  "42P01", // undefined table
]);

const describeIfConfigured = URL && KEY ? describe : describe.skip;

describeIfConfigured("Repair-Strategy RPC smoke tests", () => {
  const sb = createClient(URL!, KEY!, { auth: { persistSession: false } });

  it("admin_resolve_repair_strategy_for_package: kein Schema-Drift", async () => {
    const { error } = await sb.rpc(
      "admin_resolve_repair_strategy_for_package" as any,
      { _package_id: RANDOM_UUID },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      // Schema-Regressionen sind ein hartes FAIL — alles andere (z. B. forbidden
      // wegen fehlendem Admin-Recht, oder generic logic error) ist ok.
      expect(SCHEMA_REGRESSION_CODES.has(code)).toBe(false);
      // Defensive: Wenn die Message Schema-Drift suggeriert, auch failen.
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });

  it("admin_dry_run_repair_for_package: kein Schema-Drift", async () => {
    const { error } = await sb.rpc(
      "admin_dry_run_repair_for_package" as any,
      { _package_id: RANDOM_UUID },
    );
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      expect(SCHEMA_REGRESSION_CODES.has(code)).toBe(false);
      expect(error.message).not.toMatch(
        /column .* does not exist|function .* does not exist|relation .* does not exist/i,
      );
    }
  });
});
