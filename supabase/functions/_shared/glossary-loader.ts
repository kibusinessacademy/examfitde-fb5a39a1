/**
 * Profession Glossary Loader — On-demand cache
 * 
 * Loads or generates a profession-specific glossary containing:
 * - 50-80 domain-specific technical terms (grouped by learning field)
 * - IHK exam-relevant formulas
 * - Typical exam traps
 * - Industry-specific context
 * 
 * The glossary is cached in `profession_glossaries` and injected
 * into ALL content generator prompts for maximum depth.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "./ai-client.ts";
import { getModel } from "./model-routing.ts";

type SB = ReturnType<typeof createClient>;

export interface ProfessionGlossary {
  professionName: string;
  fachbegriffe: Record<string, string[]>;       // lernfeld → terms
  formeln: Array<{ name: string; formel: string; beispiel: string }>;
  pruefungsfallen: string[];
  szenarien: Array<{ titel: string; beschreibung: string; akteure: string[] }>;
  rechenbeispiele: Array<{ aufgabe: string; loesung: string; formel: string }>;
  branchenspezifisch: {
    typische_akteure: string[];
    arbeitsumgebungen: string[];
    dokumente: string[];
    werkzeuge_software: string[];
  };
}

// Lean prompt — optimized for speed (must complete in <60s on flash models)
const GLOSSARY_PROMPT = `Du bist ein IHK-Prüfungsexperte. Erstelle ein kompaktes Fachglosssar für "{PROFESSION}".

ANFORDERUNGEN (halte dich an die Mengenangaben!):
1. FACHBEGRIFFE: 50-80 berufsspezifische Begriffe, gruppiert nach max 6 Lernfeldern. NUR berufsspezifische Begriffe, KEINE generischen BWL-Begriffe.
2. FORMELN: 5-8 prüfungsrelevante Formeln mit Name, Formel, kurzem Beispiel.
3. PRÜFUNGSFALLEN: 8-12 typische IHK-Fehler.
4. SZENARIEN: 5 kurze Praxisszenarien (Titel, 1 Satz Beschreibung, Akteure).
5. RECHENBEISPIELE: 3 typische Aufgaben mit Lösung.
6. BRANCHENSPEZIFISCH: Je 5-8 Einträge für Akteure, Umgebungen, Dokumente, Tools.

{CURRICULUM_CONTEXT}

Antworte NUR mit JSON:
{"fachbegriffe":{"Lernfeld":["Begriff"]},"formeln":[{"name":"","formel":"","beispiel":""}],"pruefungsfallen":[""],"szenarien":[{"titel":"","beschreibung":"","akteure":[""]}],"rechenbeispiele":[{"aufgabe":"","loesung":"","formel":""}],"branchenspezifisch":{"typische_akteure":[""],"arbeitsumgebungen":[""],"dokumente":[""],"werkzeuge_software":[""]}}`;

/**
 * Read glossary from cache ONLY (no generation). Returns null if not cached.
 * Use this in time-critical functions like content generation.
 */
export async function loadCachedGlossary(
  sb: SB,
  berufId: string,
  professionName: string,
): Promise<ProfessionGlossary | null> {
  const { data: cached } = await sb
    .from("profession_glossaries")
    .select("glossary, version")
    .eq("beruf_id", berufId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached?.glossary) {
    console.log(`[glossary-loader] Cache hit for "${professionName}" v${cached.version}`);
    return { professionName, ...(cached.glossary as any) };
  }
  return null;
}

/**
 * Load glossary from cache or generate on-demand.
 * Has an explicit 80s timeout on the LLM call to stay within edge runtime limits.
 */
export async function loadOrGenerateGlossary(
  sb: SB,
  berufId: string,
  professionName: string,
  curriculumId?: string,
): Promise<ProfessionGlossary> {
  // 1) Check cache
  const { data: cached } = await sb
    .from("profession_glossaries")
    .select("glossary, version")
    .eq("beruf_id", berufId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached?.glossary) {
    console.log(`[glossary-loader] Cache hit for "${professionName}" v${cached.version}`);
    return { professionName, ...(cached.glossary as any) };
  }

  // 2) Build curriculum context (compact)
  let curriculumContext = "";
  if (curriculumId) {
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("code, title")
      .eq("curriculum_id", curriculumId)
      .order("code")
      .limit(10);

    if (lfs?.length) {
      curriculumContext = `\nLernfelder: ${lfs.map(lf => `${lf.code}: ${lf.title}`).join("; ")}`;
    }
  }

  // 3) Generate glossary with explicit timeout
  console.log(`[glossary-loader] Generating glossary for "${professionName}"...`);
  const routed = getModel("learning_content"); // Fast model
  const prompt = GLOSSARY_PROMPT
    .replace("{PROFESSION}", professionName)
    .replace("{CURRICULUM_CONTEXT}", curriculumContext);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 80_000); // 80s hard limit

  let aiResult: any;
  try {
    aiResult = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Glossar für: ${professionName}` },
      ],
      max_tokens: 2048,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).message || String(e);
    // If timeout or abort, throw a clear error
    if (msg.includes("abort") || msg.includes("timeout")) {
      throw new Error(`GLOSSARY_TIMEOUT: LLM call exceeded 80s for "${professionName}"`);
    }
    throw e;
  }
  clearTimeout(timeout);

  let glossary: Omit<ProfessionGlossary, "professionName">;
  try {
    let raw = (aiResult.content || "").trim();
    // v5.4: Multi-layer fence stripping — handles ```json\n...\n```, nested fences,
    // and partial fences that caused persistent GLOSSARY_PARSE_ERROR.
    // Layer 1: Strip opening/closing fences with any whitespace/newline combo
    raw = raw.replace(/^[\s]*```(?:json)?[\s]*\n?/gi, "").replace(/\n?[\s]*```[\s]*$/g, "").trim();
    // Layer 2: Strip ALL remaining fence markers (handles mid-text fences from streaming)
    raw = raw.replace(/```(?:json)?[\s]*/gi, "").trim();
    // Layer 3: Extract the outermost JSON object
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      raw = raw.slice(jsonStart, jsonEnd + 1);
    }
    // Layer 4: Fix trailing commas before closing brackets (common AI output error)
    raw = raw.replace(/,\s*([\]}])/g, "$1");
    // Layer 5: Fix unescaped newlines inside JSON string values
    raw = raw.replace(/(?<=":[\s]*"[^"]*)\n(?=[^"]*")/g, "\\n");
    glossary = JSON.parse(raw);
  } catch (parseErr) {
    // Layer 6: Last resort — try to extract any valid JSON object
    const rawContent = (aiResult.content || "").trim();
    const fallbackMatch = rawContent.match(/\{[\s\S]*"fachbegriffe"[\s\S]*\}/);
    if (fallbackMatch) {
      try {
        const cleaned = fallbackMatch[0].replace(/,\s*([\]}])/g, "$1");
        glossary = JSON.parse(cleaned);
      } catch {
        console.error("[glossary-loader] All parse attempts failed. Raw (first 500):", rawContent.slice(0, 500));
        throw new Error("GLOSSARY_PARSE_ERROR: Could not parse AI-generated glossary");
      }
    } else {
      console.error("[glossary-loader] No JSON structure found. Raw (first 500):", rawContent.slice(0, 500));
      throw new Error("GLOSSARY_PARSE_ERROR: No valid JSON in AI response");
    }
  }

  // 4) Cache it
  const tokenCount = (aiResult.usage?.input_tokens || 0) + (aiResult.usage?.output_tokens || 0);
  await sb.from("profession_glossaries").insert({
    beruf_id: berufId,
    profession_name: professionName,
    glossary,
    token_count: tokenCount,
  });

  console.log(`[glossary-loader] Cached glossary for "${professionName}" (${tokenCount} tokens)`);
  return { professionName, ...glossary };
}

/**
 * Format glossary for injection into generator prompts.
 * Returns a compact string suitable for system prompt context.
 */
export function formatGlossaryForPrompt(g: ProfessionGlossary): string {
  const parts: string[] = [];

  parts.push(`\n=== FACHTERMINOLOGIE-INDEX: ${g.professionName} ===`);

  // Top terms per learning field (compact)
  if (g.fachbegriffe) {
    parts.push("\nFACHBEGRIFFE (nach Lernfeld):");
    for (const [lf, terms] of Object.entries(g.fachbegriffe)) {
      parts.push(`  ${lf}: ${(terms as string[]).slice(0, 30).join(", ")}`);
    }
  }

  // Formulas
  if (g.formeln?.length) {
    parts.push("\nPRÜFUNGSRELEVANTE FORMELN:");
    for (const f of g.formeln.slice(0, 15)) {
      parts.push(`  • ${f.name}: ${f.formel} → Bsp: ${f.beispiel}`);
    }
  }

  // Exam traps
  if (g.pruefungsfallen?.length) {
    parts.push("\nTYPISCHE IHK-PRÜFUNGSFALLEN:");
    for (const t of g.pruefungsfallen.slice(0, 15)) {
      parts.push(`  ⚠ ${t}`);
    }
  }

  // Scenarios (compact)
  if (g.szenarien?.length) {
    parts.push("\nPRAXISSZENARIEN:");
    for (const s of g.szenarien.slice(0, 8)) {
      parts.push(`  📋 ${s.titel}: ${s.beschreibung.slice(0, 120)}… (Akteure: ${s.akteure.join(", ")})`);
    }
  }

  // Industry specifics
  if (g.branchenspezifisch) {
    const b = g.branchenspezifisch;
    parts.push("\nBRANCHENKONTEXT:");
    if (b.typische_akteure?.length) parts.push(`  Akteure: ${b.typische_akteure.join(", ")}`);
    if (b.arbeitsumgebungen?.length) parts.push(`  Umgebungen: ${b.arbeitsumgebungen.join(", ")}`);
    if (b.dokumente?.length) parts.push(`  Dokumente: ${b.dokumente.join(", ")}`);
    if (b.werkzeuge_software?.length) parts.push(`  Tools: ${b.werkzeuge_software.join(", ")}`);
  }

  parts.push("\n=== ENDE FACHTERMINOLOGIE-INDEX ===");
  parts.push("\nVERWENDE diese Fachbegriffe, Formeln und Szenarien aktiv in deinen Inhalten. Erfinde KEINE branchenfremden Begriffe.");

  return parts.join("\n");
}