/**
 * ExamFit@work Brand SSOT — single source of truth for all brand references.
 * Never hardcode "BerufsKI" anywhere in frontend/backend code. Import from here.
 */
export const BRAND = {
  name: "ExamFit@work",
  domain: "https://examfitwork.de",
  parent: "https://examfit.de",
  appBase: "https://examfit.de",
  emailFrom: "ExamFit@work <noreply@examfitwork.de>",
  emailReplyTo: "likeitmark9@gmail.com",
  seo: {
    title: "ExamFit@work – KI-Workflows & Copilot Prompts pro Beruf",
    desc: "Praxiserprobte KI-Workflows, Prompt-Vorlagen und Mini-SOPs – berufsbezogen, sofort nutzbar, DSGVO-sensibel.",
  },
  stripeBrand: "ExamFit@work",
  /** Old brand name for backward compat detection */
  legacyBrand: "BerufsKI",
} as const;

/** Check if a brand string matches ExamFit@work (or legacy BerufsKI) */
export function isWorkBrand(brand: string | undefined | null): boolean {
  if (!brand) return false;
  const lower = brand.toLowerCase();
  return lower.includes("examfit@work") || lower.includes("examfitwork") || lower === "berufski";
}
