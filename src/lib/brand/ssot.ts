/**
 * DEPRECATED — ExamFit@work Brand SSOT. Domain examfitwork.de existiert NICHT.
 * Nutze stattdessen `@/lib/berufos/brand` (BERUFOS.subBrands.berufsKi).
 * Re-exports bleiben für Rückwärtskompatibilität bestehender Imports.
 */
import { BERUFOS } from "@/lib/berufos/brand";

export const BRAND = {
  name: "Berufs-KI",
  domain: BERUFOS.subBrands.berufsKi.domain, // https://berufos.com/berufs-ki
  parent: BERUFOS.domain,                    // https://berufos.com
  appBase: BERUFOS.domain,
  emailFrom: `Berufs-KI <${BERUFOS.email.noreply}>`,
  emailReplyTo: BERUFOS.email.support,
  seo: {
    title: "Berufs-KI – KI-Workflows & Copilot Prompts pro Beruf",
    desc: "Praxiserprobte KI-Workflows, Prompt-Vorlagen und Mini-SOPs – berufsbezogen, sofort nutzbar, DSGVO-sensibel.",
  },
  stripeBrand: "Berufs-KI",
  /** Old brand names for backward compat detection */
  legacyBrand: "BerufsKI",
} as const;

/** Check if a brand string matches the WorkforceOS sub-brand (or any legacy alias) */
export function isWorkBrand(brand: string | undefined | null): boolean {
  if (!brand) return false;
  const lower = brand.toLowerCase();
  return (
    lower.includes("berufs-ki") ||
    lower.includes("berufski") ||
    lower.includes("examfit@work") ||
    lower.includes("examfitwork")
  );
}

