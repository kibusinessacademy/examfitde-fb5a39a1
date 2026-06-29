/**
 * Unclassifiable Hero-Phrasing Logger.
 *
 * Sammelt Datensätze, die der Hero-Phrasing-SSOT nicht eindeutig klassifizieren
 * kann (kein bekannter catalog_type + keine Heuristik gegriffen), oder die nur
 * mit niedriger Confidence klassifiziert wurden.
 *
 * - Loggt einmal pro Record (de-duped) als console.warn.
 * - Hält ein in-memory Buffer für Admin-Reports.
 * - Feuert ein DOM-Event `vlo:hero-unclassifiable` (Browser), das Admin-UIs
 *   und QA-Tools abonnieren können.
 * - Vollständig SSR-/Test-safe.
 */

export interface UnclassifiableHeroEntry {
  title: string;
  catalogType: string | null;
  chamberType: string | null;
  recordId: string | null;
  slug: string | null;
  confidence: "high" | "medium" | "low";
  isUnknown: boolean;
  /** Frozen-fixed Marker, kein realer Clock-IO im Test. */
  loggedAt: string;
}

const buffer: UnclassifiableHeroEntry[] = [];
const seenKeys = new Set<string>();

function buildKey(input: {
  title: string;
  catalogType: string | null;
  recordId: string | null;
  slug: string | null;
}): string {
  return [
    input.recordId ?? "",
    input.slug ?? "",
    input.catalogType ?? "",
    input.title ?? "",
  ]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

export function reportUnclassifiableHeroPhrasing(input: Omit<UnclassifiableHeroEntry, "loggedAt">): void {
  const key = buildKey(input);
  if (seenKeys.has(key)) return;
  seenKeys.add(key);

  const entry: UnclassifiableHeroEntry = {
    ...input,
    loggedAt: new Date().toISOString(),
  };
  buffer.push(entry);
  if (buffer.length > 200) buffer.shift();

  // Dev-/QA-Warning. Niemals throw — UI bleibt nutzbar.
  // eslint-disable-next-line no-console
  console.warn(
    "[hero-phrasing] unclassifiable qualification — fallback used",
    entry,
  );

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(
        new CustomEvent("vlo:hero-unclassifiable", { detail: entry }),
      );
    } catch {
      /* ignore — non-DOM env or CSP blocking custom events */
    }
  }
}

export function listUnclassifiableHeroEntries(): UnclassifiableHeroEntry[] {
  return [...buffer];
}

/** Test-only Reset. */
export function __resetUnclassifiableHeroLogger(): void {
  buffer.length = 0;
  seenKeys.clear();
}
