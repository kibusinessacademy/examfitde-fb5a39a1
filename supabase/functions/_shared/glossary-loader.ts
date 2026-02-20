/**
 * Profession Glossary Loader — On-demand cache
 * 
 * Loads or generates a profession-specific glossary containing:
 * - 200-400 domain-specific technical terms (grouped by learning field)
 * - IHK exam-relevant formulas + calculation examples
 * - Typical exam traps & error patterns
 * - Industry-specific scenarios, actors, and settings
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

const GLOSSARY_PROMPT = `Du bist ein IHK-Prüfungsexperte und Fachterminologie-Spezialist.

Erstelle ein UMFASSENDES Fachbegriff-Glossar für den Beruf "{PROFESSION}".

ANFORDERUNGEN:
1. FACHBEGRIFFE: 200-400 berufsspezifische Begriffe, GRUPPIERT nach Lernfeldern/Themenbereichen. NUR Begriffe die EXKLUSIV oder PRIMÄR in diesem Beruf vorkommen. KEINE generischen BWL-Begriffe die in jedem Beruf gleich sind.

2. FORMELN: Alle prüfungsrelevanten Formeln mit:
   - Name der Formel
   - Mathematische Darstellung
   - Konkretes Rechenbeispiel mit NICHT-RUNDEN Zahlen aus dem Berufsalltag

3. PRÜFUNGSFALLEN: 15-25 typische IHK-Prüfungsfallen die Azubis in diesem Beruf regelmäßig falsch beantworten. Konkret und berufsspezifisch.

4. SZENARIEN: 10-15 realistische Praxisszenarien aus dem Berufsalltag mit:
   - Konkretem Titel
   - Situationsbeschreibung
   - Beteiligte Akteure (mit berufstypischen Rollen)

5. RECHENBEISPIELE: 5-10 typische Prüfungsrechnungen mit Aufgabe, Lösung und verwendeter Formel.

6. BRANCHENSPEZIFISCH:
   - Typische Akteure/Rollen im Betrieb
   - Arbeitsumgebungen (wo arbeitet man konkret?)
   - Branchentypische Dokumente/Formulare
   - Werkzeuge, Software, Maschinen

WICHTIG: 
- KEINE generischen Begriffe die in JEDEM Beruf identisch sind
- Begriffe müssen den IHK-Prüfungsanforderungen entsprechen
- Szenarien müssen REALISTISCH und KONKRET sein (keine KI-Floskeln)
- Rechenbeispiele mit NICHT-RUNDEN Zahlen (z.B. 4.387,50€ statt 5.000€)

{CURRICULUM_CONTEXT}

Antworte AUSSCHLIESSLICH mit JSON:
{
  "fachbegriffe": {"Lernfeld 1 Titel": ["Begriff1", "Begriff2", ...], ...},
  "formeln": [{"name": "...", "formel": "...", "beispiel": "..."}],
  "pruefungsfallen": ["Falle 1...", "Falle 2..."],
  "szenarien": [{"titel": "...", "beschreibung": "...", "akteure": ["..."]}],
  "rechenbeispiele": [{"aufgabe": "...", "loesung": "...", "formel": "..."}],
  "branchenspezifisch": {
    "typische_akteure": ["..."],
    "arbeitsumgebungen": ["..."],
    "dokumente": ["..."],
    "werkzeuge_software": ["..."]
  }
}`;

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

  // 2) Build curriculum context
  let curriculumContext = "";
  if (curriculumId) {
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("code, title")
      .eq("curriculum_id", curriculumId)
      .order("code");

    if (lfs?.length) {
      curriculumContext = `\nLERNFELDER des Berufs:\n${lfs.map(lf => `- ${lf.code}: ${lf.title}`).join("\n")}`;
    }
  }

  // 3) Generate glossary
  console.log(`[glossary-loader] Generating glossary for "${professionName}"...`);
  const routed = getModel("quality_audit"); // Use high-quality model for glossary
  const prompt = GLOSSARY_PROMPT
    .replace("{PROFESSION}", professionName)
    .replace("{CURRICULUM_CONTEXT}", curriculumContext);

  const aiResult = await callAIJSON({
    provider: routed.provider,
    model: routed.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: `Erstelle das Glossar für: ${professionName}` },
    ],
    max_tokens: 8192,
  });

  let glossary: Omit<ProfessionGlossary, "professionName">;
  try {
    const cleaned = aiResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    glossary = JSON.parse(cleaned);
  } catch {
    console.error("[glossary-loader] Failed to parse glossary JSON");
    throw new Error("GLOSSARY_PARSE_ERROR: Could not parse AI-generated glossary");
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
