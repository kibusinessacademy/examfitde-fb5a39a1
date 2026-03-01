/**
 * ExamFit@work Brand SSOT for Deno Edge Functions.
 * Mirror of src/lib/brand/ssot.ts but without TS path aliases.
 */
export const BRAND = {
  name: "ExamFit@work",
  domain: "https://examfitwork.de",
  parent: "https://examfit.de",
  appBase: "https://examfit.de",
  stripeBrand: "ExamFit@work",
  legacyBrand: "BerufsKI",
} as const;

export function isWorkBrand(brand: string | undefined | null): boolean {
  if (!brand) return false;
  const lower = brand.toLowerCase();
  return lower.includes("examfit@work") || lower.includes("examfitwork") || lower === "berufski";
}
