/**
 * BerufOS Brand + Module SSOT — Edge Function shared mirror (Deno).
 * Mirror of src/lib/berufos/brand.ts + modules.ts canonical slug list.
 * Edge-Functions importieren NUR von hier (kein Cross-Tree-Import in src/).
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

export function resolveBerufosSlug(slug: string): string {
  return BERUFOS_SLUG_ALIASES[slug] ?? slug;
}

export function isValidBerufosSlug(slug: string): boolean {
  return (BERUFOS_MODULE_SLUGS as readonly string[]).includes(resolveBerufosSlug(slug));
}
