/**
 * Provider-specific parsers for qualification documents (IHK, HWK, BIBB, misc).
 */

interface ParseInput {
  providerFamily: string;
  title: string;
  text: string;
  url: string;
}

interface ParseResult {
  canonical_title: string;
  education_type: string | null;
  award_type: string | null;
  provider_family: string;
  source_authority: string | null;
  legal_basis: string | null;
  regulation_reference: string | null;
  exam_parts: unknown[];
  handlungsbereiche: unknown[];
  competency_areas: unknown[];
  oral_components: unknown[];
  project_components: unknown[];
  admission_rules: Record<string, unknown>;
  pass_rules: Record<string, unknown>;
  title_aliases: string[];
  evidence: Record<string, unknown>;
  quality_score: number;
  warnings: string[];
}

function extractBetween(text: string, start: RegExp, end: RegExp): string {
  const s = text.search(start);
  if (s === -1) return "";
  const sub = text.slice(s);
  const e = sub.search(end);
  return e > 0 ? sub.slice(0, e).trim() : sub.slice(0, 2000).trim();
}

function detectAwardType(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("meister")) return "Meister";
  if (t.includes("fachwirt")) return "Fachwirt";
  if (t.includes("betriebswirt")) return "Betriebswirt";
  if (t.includes("fachkaufmann") || t.includes("fachkauffrau")) return "Fachkaufmann";
  if (t.includes("techniker")) return "Techniker";
  if (t.includes("bachelor professional")) return "Bachelor Professional";
  if (t.includes("master professional")) return "Master Professional";
  return null;
}

function detectEducationType(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("fortbildung")) return "Fortbildung";
  if (t.includes("umschulung")) return "Umschulung";
  if (t.includes("ausbildung")) return "Ausbildung";
  return null;
}

function extractExamParts(text: string): unknown[] {
  const parts: unknown[] = [];
  const regex = /(?:Teil|Prüfungsteil|Prüfungsbereich)\s*(\d+|[IVX]+)[:\s]+([^\n]{5,80})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    parts.push({ part: m[1], title: m[2].trim() });
  }
  return parts;
}

function extractHandlungsbereiche(text: string): unknown[] {
  const areas: unknown[] = [];
  const regex = /Handlungsbereich\s*(\d+)[:\s]+([^\n]{5,100})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    areas.push({ number: parseInt(m[1]), title: m[2].trim() });
  }
  return areas;
}

function parseIHK(input: ParseInput): ParseResult {
  const { title, text, url } = input;
  const warnings: string[] = [];
  const award = detectAwardType(text) || detectAwardType(title);
  if (!award) warnings.push("award_type_not_detected");

  return {
    canonical_title: title.replace(/\s+/g, " ").trim(),
    education_type: detectEducationType(text) || "Fortbildung",
    award_type: award,
    provider_family: "ihk",
    source_authority: "IHK",
    legal_basis: text.match(/§\s*\d+[^.\n]{0,60}/)?.[0] || null,
    regulation_reference: text.match(/(?:Verordnung|VO)\s+vom\s+\d{1,2}\.\s*\w+\s*\d{4}/i)?.[0] || null,
    exam_parts: extractExamParts(text),
    handlungsbereiche: extractHandlungsbereiche(text),
    competency_areas: [],
    oral_components: text.toLowerCase().includes("mündlich") ? [{ type: "oral", detected: true }] : [],
    project_components: text.toLowerCase().includes("projektarbeit") ? [{ type: "project", detected: true }] : [],
    admission_rules: {},
    pass_rules: {},
    title_aliases: [],
    evidence: { source_url: url, parser: "ihk-v3" },
    quality_score: Math.min(100, 30 + (award ? 20 : 0) + (extractExamParts(text).length > 0 ? 25 : 0) + (extractHandlungsbereiche(text).length > 0 ? 25 : 0)),
    warnings,
  };
}

function parseHWK(input: ParseInput): ParseResult {
  const base = parseIHK(input);
  base.provider_family = "hwk";
  base.source_authority = "HWK";
  base.evidence = { ...base.evidence, parser: "hwk-v3" };
  return base;
}

function parseBIBB(input: ParseInput): ParseResult {
  const base = parseIHK(input);
  base.provider_family = "bibb";
  base.source_authority = "BIBB";
  base.evidence = { ...base.evidence, parser: "bibb-v3" };
  return base;
}

function parseMisc(input: ParseInput): ParseResult {
  const base = parseIHK(input);
  base.provider_family = input.providerFamily;
  base.source_authority = null;
  base.evidence = { ...base.evidence, parser: "misc-v3" };
  base.quality_score = Math.max(0, base.quality_score - 10);
  return base;
}

export function parseByProviderFamily(input: ParseInput): ParseResult {
  switch (input.providerFamily) {
    case "ihk": return parseIHK(input);
    case "hwk": return parseHWK(input);
    case "bibb": return parseBIBB(input);
    default: return parseMisc(input);
  }
}
