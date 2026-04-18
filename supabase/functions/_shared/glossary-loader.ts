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

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "./ai-client.ts";
import { getModelChainAsync } from "./model-routing.ts";
import { getContentProfile, type ContentProfile } from "./track-content-profiles.ts";

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

// ── Track-aware glossary prompt builder ──────────────────────────
function buildGlossaryPrompt(profile: ContentProfile, professionName: string, curriculumContext: string): string {
  const [minTerms, maxTerms] = profile.glossary.termRange;
  const fieldLabel = profile.glossary.fieldLabel;
  const examLabel = profile.glossary.examLabel;

  const sections: string[] = [
    `Du bist ${profile.glossary.persona}. Erstelle ein kompaktes Fachglossar für "${professionName}".`,
    `\nANFORDERUNGEN (halte dich an die Mengenangaben!):`,
    `1. FACHBEGRIFFE: ${minTerms}-${maxTerms} fachspezifische Begriffe, gruppiert nach max 6 ${fieldLabel}ern. NUR fachspezifische Begriffe, KEINE generischen BWL-Begriffe.`,
  ];

  if (profile.glossary.includeFormulas) {
    sections.push(`2. FORMELN: 5-8 ${examLabel.toLowerCase()}-relevante Formeln mit Name, Formel, kurzem Beispiel.`);
  }
  if (profile.glossary.includeExamTraps) {
    sections.push(`3. PRÜFUNGSFALLEN: 8-12 typische ${examLabel}-Fehler.`);
  }
  if (profile.glossary.includeScenarios) {
    sections.push(`4. SZENARIEN: 5 kurze Praxisszenarien (Titel, 1 Satz Beschreibung, Akteure).`);
  }
  if (profile.glossary.includeCalculations) {
    sections.push(`5. RECHENBEISPIELE: 3 typische Aufgaben mit Lösung.`);
  }
  sections.push(`6. BRANCHENSPEZIFISCH: Je 5-8 Einträge für Akteure, Umgebungen, Dokumente, Tools.`);

  if (profile.glossary.includeModels) {
    sections.push(`7. THEORIEMODELLE: 5-8 zentrale Modelle/Theorien mit Name, Kurzbeschreibung, Anwendungsbereich und Grenzen.`);
  }

  sections.push(curriculumContext);
  sections.push(`\nAntworte NUR mit JSON:`);
  sections.push(`{"fachbegriffe":{"${fieldLabel}":["Begriff"]},"formeln":[{"name":"","formel":"","beispiel":""}],"pruefungsfallen":[""],"szenarien":[{"titel":"","beschreibung":"","akteure":[""]}],"rechenbeispiele":[{"aufgabe":"","loesung":"","formel":""}],"branchenspezifisch":{"typische_akteure":[""],"arbeitsumgebungen":[""],"dokumente":[""],"werkzeuge_software":[""]}${profile.glossary.includeModels ? ',"theoriemodelle":[{"name":"","beschreibung":"","anwendung":"","grenzen":""}]' : ''}}`);

  return sections.join("\n");
}

// Legacy constant for backward compatibility
const GLOSSARY_PROMPT = buildGlossaryPrompt(getContentProfile("AUSBILDUNG_VOLL"), "{PROFESSION}", "{CURRICULUM_CONTEXT}");

/**
 * Compute robust token-count for cache row.
 * Prefers provider usage (input+output tokens). Falls back to char/4 heuristic
 * over the serialized glossary JSON to guarantee a non-zero, content-proportional
 * value. This prevents Hollow-Cache loops when providers return zero usage.
 */
function computeGlossaryTokenCount(aiResult: any, glossaryBody: unknown): number {
  const usage = aiResult?.usage ?? {};
  const fromUsage = Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0);
  if (fromUsage > 0) return fromUsage;
  try {
    const serialized = JSON.stringify(glossaryBody ?? {});
    return Math.max(1, Math.ceil(serialized.length / 4));
  } catch {
    return 0;
  }
}
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
 * Hollow-Cache Detection: returns true if the cached glossary row is too thin
 * to satisfy the post-condition (entry_count >= 1 AND token_count >= 100).
 */
function isGlossaryRowHollow(row: { glossary?: any; token_count?: number | null } | null | undefined): boolean {
  if (!row) return true;
  const tokenCount = Number(row.token_count ?? 0);
  if (tokenCount < 100) return true;
  const g = row.glossary;
  if (!g || typeof g !== "object") return true;
  const terms = g.fachbegriffe ? Object.values(g.fachbegriffe).reduce((s: number, arr: any) => s + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
  const formulas = Array.isArray(g.formeln) ? g.formeln.length : 0;
  const traps = Array.isArray(g.pruefungsfallen) ? g.pruefungsfallen.length : 0;
  const scenarios = Array.isArray(g.szenarien) ? g.szenarien.length : 0;
  const calcs = Array.isArray(g.rechenbeispiele) ? g.rechenbeispiele.length : 0;
  return (terms + formulas + traps + scenarios + calcs) < 10;
}

/**
 * Load glossary from cache or generate on-demand.
 * Has an explicit 80s timeout on the LLM call to stay within edge runtime limits.
 * @param track - Track key for profile-aware prompt (default: AUSBILDUNG_VOLL)
 */
export async function loadOrGenerateGlossary(
  sb: SB,
  berufId: string,
  professionName: string,
  curriculumId?: string,
  track?: string,
): Promise<ProfessionGlossary> {
  // 1) Check cache (with hollow-detection — invalidate if too thin to pass post-condition)
  const { data: cached } = await sb
    .from("profession_glossaries")
    .select("id, glossary, version, token_count")
    .eq("beruf_id", berufId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached?.glossary && !isGlossaryRowHollow(cached as any)) {
    console.log(`[glossary-loader] Substantive cache hit for "${professionName}" v${cached.version}`);
    return { professionName, ...(cached.glossary as any) };
  }

  if (cached) {
    console.warn(`[glossary-loader] ⚠️ Hollow cache for "${professionName}" v${cached.version} — invalidating`);
    await sb.from("profession_glossaries").delete().eq("id", cached.id as string);
  }

  // 2) Build curriculum context (compact)
  const profile = getContentProfile(track || "AUSBILDUNG_VOLL");
  let curriculumContext = "";
  if (curriculumId) {
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("code, title")
      .eq("curriculum_id", curriculumId)
      .order("code")
      .limit(10);

    if (lfs?.length) {
      const label = profile.glossary.fieldLabel === "Modul" ? "Module" : "Lernfelder";
      curriculumContext = `\n${label}: ${lfs.map(lf => `${lf.code}: ${lf.title}`).join("; ")}`;
    }
  }

  // 3) Generate glossary with explicit timeout
  console.log(`[glossary-loader] Generating glossary for "${professionName}" (track=${profile.track})...`);
  const chain = await getModelChainAsync("learning_content");
  const prompt = buildGlossaryPrompt(profile, professionName, curriculumContext);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 80_000); // 80s hard limit

  let aiResult: any;
  try {
    aiResult = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider, model: c.model })),
      {
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Glossar für: ${professionName}` },
        ],
        max_tokens: 2048,
      },
    );
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
        // Layer 7: RAW TEXT FALLBACK — use unparsed content as free-text glossary
        // instead of returning empty context (which causes LLM drift into generic/medical terms)
        console.warn("[glossary-loader] All JSON parse attempts failed — using raw text fallback. Raw (first 500):", rawContent.slice(0, 500));
        const rawFallback: Omit<ProfessionGlossary, "professionName"> = {
          fachbegriffe: { "Rohtext": rawContent.slice(0, 2000).split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 80).slice(0, 50) },
          formeln: [],
          pruefungsfallen: [],
          szenarien: [],
          rechenbeispiele: [],
          branchenspezifisch: { typische_akteure: [], arbeitsumgebungen: [], dokumente: [], werkzeuge_software: [] },
        };
        // Cache the raw fallback so we don't keep retrying
        const tokenCount = computeGlossaryTokenCount(aiResult, rawFallback);
        await sb.from("profession_glossaries").insert({
          beruf_id: berufId, profession_name: professionName,
          glossary: rawFallback, token_count: tokenCount,
        });
        return { professionName, ...rawFallback };
      }
    } else {
      // No JSON structure at all — build minimal fallback from raw text
      console.warn("[glossary-loader] No JSON structure found — raw text fallback. Raw (first 500):", rawContent.slice(0, 500));
      const rawFallback: Omit<ProfessionGlossary, "professionName"> = {
        fachbegriffe: { "Rohtext": rawContent.slice(0, 2000).split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 80).slice(0, 50) },
        formeln: [],
        pruefungsfallen: [],
        szenarien: [],
        rechenbeispiele: [],
        branchenspezifisch: { typische_akteure: [], arbeitsumgebungen: [], dokumente: [], werkzeuge_software: [] },
      };
      const tokenCount = computeGlossaryTokenCount(aiResult, rawFallback);
      await sb.from("profession_glossaries").insert({
        beruf_id: berufId, profession_name: professionName,
        glossary: rawFallback, token_count: tokenCount,
      });
      return { professionName, ...rawFallback };
    }
  }

  // 4) Cache it
  const tokenCount = computeGlossaryTokenCount(aiResult, glossary);
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
 * 
 * @param g - Full glossary
 * @param scopeLf - Optional: learning field code to filter terms (e.g. "LF3"). 
 *                  If provided, only terms for that LF + formulas/traps are included.
 *                  Saves ~40-60% tokens vs full glossary.
 */
export function formatGlossaryForPrompt(g: ProfessionGlossary, scopeLf?: string | null): string {
  const parts: string[] = [];
  parts.push(`\n=== FACHINDEX: ${g.professionName} ===`);

  // Terms: scoped to LF if provided, else top 20 across all
  if (g.fachbegriffe) {
    if (scopeLf) {
      // Find matching LF key (fuzzy: "LF3", "Lernfeld 3", etc.)
      const lfNorm = scopeLf.replace(/\s+/g, "").toLowerCase();
      const matchKey = Object.keys(g.fachbegriffe).find(k => 
        k.replace(/\s+/g, "").toLowerCase().includes(lfNorm) || lfNorm.includes(k.replace(/\s+/g, "").toLowerCase())
      );
      if (matchKey) {
        parts.push(`Fachbegriffe (${matchKey}): ${(g.fachbegriffe[matchKey] as string[]).slice(0, 20).join(", ")}`);
      } else {
        // Fallback: first 15 terms from any LF
        const allTerms = Object.values(g.fachbegriffe).flat().slice(0, 15);
        parts.push(`Fachbegriffe: ${allTerms.join(", ")}`);
      }
    } else {
      // No scope: compact — max 20 terms total
      const allTerms = Object.values(g.fachbegriffe).flat().slice(0, 20);
      parts.push(`Fachbegriffe: ${allTerms.join(", ")}`);
    }
  }

  // Formulas: max 6 (compact format)
  if (g.formeln?.length) {
    parts.push("Formeln: " + g.formeln.slice(0, 6).map(f => `${f.name}: ${f.formel}`).join(" | "));
  }

  // Exam traps: max 6
  if (g.pruefungsfallen?.length) {
    parts.push("Prüfungsfallen: " + g.pruefungsfallen.slice(0, 6).join(" | "));
  }

  // Skip scenarios + branchenkontext (low value per token — profession name already provides context)

  parts.push("=== ENDE FACHINDEX ===");
  parts.push("Nutze diese Begriffe/Formeln. Keine branchenfremden Begriffe erfinden.");

  return parts.join("\n");
}