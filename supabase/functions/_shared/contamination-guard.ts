/**
 * Contamination Guard — blocks cross-profession content pollution.
 * 
 * After every AI generation, run checkContamination() to detect
 * industry-specific terms that don't belong to the target profession.
 * 
 * Extensible: add new profession → keyword sets as needed.
 */

// Industry-specific keyword sets (lowercase)
// IMPORTANT: "pharmazie" is a SEPARATE industry from "medizin".
// PKA (Pharmazeutisch-kaufmännische Angestellte) work with Rezepte, Medikamente,
// Patienten etc. in a COMMERCIAL/LOGISTICS context — these are NOT clinical terms for them.
const INDUSTRY_KEYWORDS: Record<string, RegExp> = {
  automobil: /\b(autohaus|werkstatt|fahrzeug|probefahrt|karosserie|kfz|automobil|lackier|inspektion|hauptuntersuchung|hebebühne|ölwechsel|bremsbelag|radwechsel|autohändler|gebrauchtwagen|neuwagen|fahrzeugbrief|fahrzeugschein|tüv|dekra|motoröl|reifen|achsvermessung)\b/i,
  // "rezept" removed — ambiguous (Kochrezept vs Arzneimittelrezept). Use "kochrezept" for gastro.
  gastronomie: /\b(küche|koch|speisekarte|menü|kochrezept|gastronomie|restaurant|mise en place|haccp|lebensmittelhygiene|servieren|kellner|gastgeber|hotellerie)\b/i,
  medizin: /\b(diagnose|therapie|krankenhaus|arztpraxis|anamnese|blutdruck|infusion|op\b|chirurg|pflege|klinik|visite|stationsarzt|oberarzt|chefarzt|krankenschwester|intensivstation|notaufnahme)\b/i,
  pharmazie: /\b(apotheke|pharmazie|pka|pta|pharmazeutisch|arzneimittel|medikament|rezeptur|defektur|btmvv|betäubungsmittel|pharmazentralnummer|pzn|apothekenverkaufspreis|gkv|kassenrezept|privatrezept|e-rezept|arzneimittelgesetz|amg|apothekengesetz|apothekenbetriebsordnung|kühlkette|chargenrückruf|retaxation|rabattvertrag|hilfsmittel|rezept)\b/i,
  it: /\b(programmier|software|datenbank|server|netzwerk|firewall|api|frontend|backend|deployment|debugging|repository|compiler)\b/i,
  bau: /\b(baustelle|maurer|beton|estrich|gerüst|rohbau|fundament|schalung|trockenbau|putz|fliesen|sanitär|heizung|dachstuhl)\b/i,
};

// Map profession names to their industry (so we know WHICH keywords are ALLOWED)
function detectProfessionIndustry(professionName: string): string | null {
  const lower = professionName.toLowerCase();
  // IMPORTANT: pharmazie MUST be checked BEFORE medizin, because PKA contains
  // "pharmazeutisch" which should map to pharmazie, not medizin.
  if (/auto|kfz|fahrzeug|kraftfahrzeug|automobil/i.test(lower)) return "automobil";
  if (/koch|küche|gastro|hotel|restaurant/i.test(lower)) return "gastronomie";
  if (/pharma|pka|pta|apothek/i.test(lower)) return "pharmazie";
  if (/medizin|arzt|pflege|gesundheit|kranken|mfa|medizinisch/i.test(lower)) return "medizin";
  if (/informatik|fachinformatik|software|it-/i.test(lower)) return "it";
  if (/bau|maurer|zimmerer|dachdecker|anlagenmechaniker/i.test(lower)) return "bau";
  return null;
}

export interface ContaminationResult {
  isContaminated: boolean;
  detectedIndustry: string | null;
  matchedTerms: string[];
  professionIndustry: string | null;
}

/**
 * Check if generated text contains terms from a FOREIGN industry.
 * Returns contamination details. The caller decides whether to reject.
 */
// Adjacent industries whose terms naturally co-occur
// (e.g., MFA handles Medikamente → pharmazie terms are expected)
const ADJACENT_INDUSTRIES: Record<string, string[]> = {
  medizin: ["pharmazie"],     // MFA naturally mentions medications/prescriptions
  pharmazie: ["medizin"],     // PKA naturally mentions diagnoses/therapies
};

// Minimum unique foreign terms to count as real contamination
// Single stray term = noise, 3+ = real cross-profession pollution
const CONTAMINATION_THRESHOLD = 3;

export function checkContamination(
  text: string,
  professionName: string,
): ContaminationResult {
  const professionIndustry = detectProfessionIndustry(professionName);
  const matchedTerms: string[] = [];
  let detectedIndustry: string | null = null;

  // Which industries are allowed (own + adjacent)
  const allowedIndustries = new Set<string>();
  if (professionIndustry) {
    allowedIndustries.add(professionIndustry);
    for (const adj of ADJACENT_INDUSTRIES[professionIndustry] || []) {
      allowedIndustries.add(adj);
    }
  }

  for (const [industry, regex] of Object.entries(INDUSTRY_KEYWORDS)) {
    // Skip the profession's own and adjacent industries
    if (allowedIndustries.has(industry)) continue;

    const matches = text.match(new RegExp(regex.source, "gi"));
    if (matches && matches.length > 0) {
      detectedIndustry = industry;
      matchedTerms.push(...matches.map(m => m.toLowerCase()));
    }
  }

  // Deduplicate
  const uniqueTerms = [...new Set(matchedTerms)];

  return {
    isContaminated: uniqueTerms.length >= CONTAMINATION_THRESHOLD,
    detectedIndustry,
    matchedTerms: uniqueTerms,
    professionIndustry,
  };
}

/**
 * Check contamination and throw if found.
 * Use this as a hard gate after AI generation.
 */
export function assertNoContamination(
  text: string,
  professionName: string,
  context?: string,
): void {
  const result = checkContamination(text, professionName);
  if (result.isContaminated) {
    console.error(
      `[CONTAMINATION BLOCKED] Profession="${professionName}" (industry=${result.professionIndustry}), ` +
      `detected foreign industry="${result.detectedIndustry}", terms=[${result.matchedTerms.join(", ")}]` +
      (context ? `, context=${context}` : "")
    );
    throw new Error(
      `CONTAMINATION_DETECTED: Foreign industry "${result.detectedIndustry}" terms found in content for "${professionName}": [${result.matchedTerms.slice(0, 5).join(", ")}]`
    );
  }
}
