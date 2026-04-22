/**
 * healErrorParser
 * ───────────────
 * Übersetzt Postgres-/PostgREST-/Edge-Function-Fehler aus Heal-/Repair-RPCs in
 * verständliche, handlungsorientierte Meldungen für die Admin-UI.
 *
 * Ziel: Statt nur „0 verarbeitet · 0 Fehler" zeigen wir konkret, ob z. B. eine
 * Spalte/Funktion fehlt (Schema-Drift) oder ein Permission/Logikproblem vorliegt.
 */

export interface ParsedHealError {
  /** Kurze Überschrift für Toast/Dialog (z. B. „Schema-Mismatch") */
  title: string;
  /** Ausführliche Erklärung in deutscher Sprache */
  description: string;
  /** Tag für Telemetrie & Filter */
  kind:
    | "schema_missing_column"
    | "schema_missing_function"
    | "schema_missing_relation"
    | "permission_denied"
    | "rpc_returned_errors"
    | "network"
    | "unknown";
  /** Liste roher Detail-Zeilen aus result.details (Reason je Job, falls vorhanden) */
  details?: string[];
  /** Original-Message für Copy/Audit */
  raw: string;
}

const PG_CODE_RE = /\b(?:code\s*[:=]\s*)?["']?(42703|42883|42P01|42501)["']?/i;

const COLUMN_RE =
  /column\s+([a-z_."]+)?\s*(?:does not exist|fehlt|fehlt nicht|missing|unbekannt)/i;
const FUNCTION_RE =
  /function\s+([a-z_.()0-9, ]+?)\s*(?:does not exist|fehlt|missing)/i;
const RELATION_RE =
  /relation\s+["']?([a-z0-9_."]+)["']?\s*(?:does not exist|fehlt)/i;

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Versucht aus einem beliebigen Fehlerobjekt (Error, Supabase-Error, RPC-Result)
 * eine konkrete Diagnose zu erzeugen.
 */
export function parseHealError(err: unknown): ParsedHealError {
  // Fall 0: Result-Objekt mit details[] (RPC erfolgreich, aber Jobs hatten Errors)
  if (err && typeof err === "object" && "result" in (err as any)) {
    const r = (err as any).result ?? {};
    const details: string[] = Array.isArray(r.details)
      ? r.details
          .map((d: any) => {
            const action = d?.action ?? "?";
            const strategy = d?.strategy ? ` → ${d.strategy}` : "";
            const reason = d?.reason ? ` (${d.reason})` : "";
            const errMsg = d?.error ? ` · ${d.error}` : "";
            return `${action}${strategy}${reason}${errMsg}`;
          })
          .filter(Boolean)
      : [];

    if ((r.errors ?? 0) > 0 || details.length > 0) {
      return {
        title: "Heilung mit Fehlern abgeschlossen",
        description:
          `${r.errors ?? 0} Fehler bei ${r.processed ?? 0} verarbeiteten Jobs. ` +
          (details[0] ? `Erster Grund: ${details[0]}` : ""),
        kind: "rpc_returned_errors",
        details,
        raw: asString(r),
      };
    }
  }

  const msg = asString(
    (err as any)?.message ?? (err as any)?.error_description ?? err ?? "",
  );
  const code = asString((err as any)?.code ?? "");
  const hint = asString((err as any)?.hint ?? "");
  const combined = `${code} ${msg} ${hint}`.toLowerCase();
  const pgMatch = PG_CODE_RE.exec(combined);
  const pgCode = pgMatch?.[1]?.toUpperCase() ?? code.toUpperCase();

  // 42703 — undefined column
  if (pgCode === "42703" || COLUMN_RE.test(msg)) {
    const col = COLUMN_RE.exec(msg)?.[1] ?? "?";
    return {
      title: "Schema-Mismatch: Spalte fehlt",
      description:
        `Die Datenbank-Funktion verweist auf eine Spalte, die nicht existiert: ${col}. ` +
        `Das deutet auf Schema-Drift zwischen Migration und RPC hin. Bitte Migration ausführen.`,
      kind: "schema_missing_column",
      raw: msg,
    };
  }

  // 42883 — undefined function
  if (pgCode === "42883" || FUNCTION_RE.test(msg)) {
    const fn = FUNCTION_RE.exec(msg)?.[1] ?? "?";
    return {
      title: "Schema-Mismatch: Funktion fehlt",
      description:
        `Die aufgerufene Datenbank-Funktion existiert nicht oder hat eine andere Signatur: ${fn}. ` +
        `Bitte zugehörige Migration deployen.`,
      kind: "schema_missing_function",
      raw: msg,
    };
  }

  // 42P01 — undefined table
  if (pgCode === "42P01" || RELATION_RE.test(msg)) {
    const rel = RELATION_RE.exec(msg)?.[1] ?? "?";
    return {
      title: "Schema-Mismatch: Tabelle/View fehlt",
      description:
        `Die Relation ${rel} existiert nicht. Migration fehlt oder wurde zurückgerollt.`,
      kind: "schema_missing_relation",
      raw: msg,
    };
  }

  // 42501 — permission denied
  if (pgCode === "42501" || /permission denied|not authorized/i.test(msg)) {
    return {
      title: "Berechtigung verweigert",
      description:
        "Der aktuelle Account darf diese Reparatur-Aktion nicht ausführen (admin_only).",
      kind: "permission_denied",
      raw: msg,
    };
  }

  if (/failed to fetch|networkerror|aborted/i.test(msg)) {
    return {
      title: "Netzwerkfehler",
      description: "Die Anfrage erreichte den Server nicht. Bitte erneut versuchen.",
      kind: "network",
      raw: msg,
    };
  }

  return {
    title: "Aktion fehlgeschlagen",
    description: msg || "Unbekannter Fehler beim Ausführen der Heilung.",
    kind: "unknown",
    raw: msg,
  };
}
