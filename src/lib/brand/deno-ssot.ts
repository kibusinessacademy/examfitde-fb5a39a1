/**
 * DEPRECATED Brand SSOT for Deno Edge Functions (mirror of ssot.ts).
 * examfitwork.de / berufski.de existieren NICHT. Nutze berufos.com/berufs-ki.
 */
export const BRAND = {
  name: "Berufs-KI",
  domain: "https://berufos.com/berufs-ki",
  parent: "https://berufos.com",
  appBase: "https://berufos.com",
  stripeBrand: "Berufs-KI",
  legacyBrand: "BerufsKI",
} as const;

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
