/**
 * BerufOS Brand SSOT — Edge Function Mirror (Deno, no TS path aliases).
 * Halte synchron mit src/lib/berufos/brand.ts + modules.ts.
 *
 * F1-Fix (Funktionsaudit 2026-05-29): Slug-Whitelist + Legacy-Aliase leben
 * jetzt hier, damit Edge (berufos-waitlist) und Frontend nicht driften.
 * Erweitern heißt: hier + modules.ts gemeinsam pflegen.
 */
export const BERUFOS = {
  name: "BerufOS",
  tagline: "Das AI-Betriebssystem für Berufe.",
  domain: "https://berufos.com",
  hubPath: "/berufos",
} as const;

/** Canonical Modul-Slugs (M1-Migration 2026-05-25, +voiceos). */
export const BERUFOS_MODULE_SLUGS = [
  "examfit",
  "berufs-ki",
  "agents",
  "documents",
  "workflows",
  "skills",
  "career",
  "recruit",
  "industries",
  "governance",
  "voiceos",
] as const;

/** Legacy-Slug-Aliase (Pre-M1). Werden auf Canonical normalisiert. */
export const BERUFOS_SLUG_ALIASES: Record<string, string> = {
  learning: "examfit",
  workforce: "berufs-ki",
  industry: "industries",
};

/** Normalisiert einen Input-Slug auf den Canonical-Slug (oder gibt ihn zurück). */
export function resolveBerufosSlug(slug: string): string {
  return BERUFOS_SLUG_ALIASES[slug] ?? slug;
}

/** True, wenn slug (nach Alias-Auflösung) ein bekanntes Modul ist. */
export function isValidBerufosSlug(slug: string): boolean {
  return (BERUFOS_MODULE_SLUGS as readonly string[]).includes(resolveBerufosSlug(slug));
}
