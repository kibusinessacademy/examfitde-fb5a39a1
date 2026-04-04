import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";

/**
 * Mass Competency Enrichment v2 — RPC-only, no nested joins
 *
 * Adds profession-specific misconceptions, transfer markers, and
 * context conditions to ALL unenriched competencies across all curricula.
 *
 * Body: { batch_size?, max_curricula? }
 * Called every minute via cron until all 14k+ competencies are done.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/* ── Validators ── */

function validateMisconception(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.claim === "string" && o.claim.length >= 10 &&
    typeof o.why_wrong === "string" && o.why_wrong.length >= 10 &&
    typeof o.correct_principle === "string" &&
    o.correct_principle.length >= 10 &&
    typeof o.quick_fix === "string" && o.quick_fix.length >= 5 &&
    typeof o.example_trap === "string" && o.example_trap.length >= 20
  );
}

function validateTransferMarker(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.context === "string" && o.context.length >= 10 &&
    typeof o.what_changes === "string" && o.what_changes.length >= 5 &&
    typeof o.what_stays === "string" && o.what_stays.length >= 5 &&
    Array.isArray(o.cue_words) && o.cue_words.length >= 2 &&
    o.cue_words.every((w: unknown) => typeof w === "string" && w.length >= 2)
  );
}

function safeParse(raw: string): unknown | null {
  // Strip markdown code fences (```json ... ```)
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* */ }

  // Try strict extraction first (balanced object/array)
  const strict = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (strict) {
    try { return JSON.parse(strict[1]); } catch { /* */ }
  }

  // Fallback for truncated model output: take from first JSON opener to end and repair
  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const first = [firstObj, firstArr].filter((x) => x >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return null;

  let attempt = cleaned.slice(first).replace(/,\s*$/, "");
  attempt = attempt.replace(/,\s*"[^"]*"?\s*:?\s*$/, "");

  const openBraces = (attempt.match(/\{/g) || []).length;
  const closeBraces = (attempt.match(/\}/g) || []).length;
  const openBrackets = (attempt.match(/\[/g) || []).length;
  const closeBrackets = (attempt.match(/\]/g) || []).length;

  for (let i = 0; i < openBraces - closeBraces; i++) attempt += "}";
  for (let i = 0; i < openBrackets - closeBrackets; i++) attempt += "]";

  try { return JSON.parse(attempt); } catch { return null; }
}

function parseEnrichmentsFromRaw(raw: string): any[] | null {
  const parsed = safeParse(raw);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed as any[];
  const wrapped = (parsed as any)?.enrichments;
  return Array.isArray(wrapped) ? wrapped : null;
}

const ENRICHMENT_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_enrichments",
    description: "Return validated enrichment payload for competencies.",
    parameters: {
      type: "object",
      properties: {
        enrichments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              context_conditions: { type: "string" },
              misconceptions: { type: "array", items: { type: "object" } },
              transfer_markers: { type: "array", items: { type: "object" } },
            },
            required: ["id"],
          },
        },
      },
      required: ["enrichments"],
    },
  },
};

function parseEnrichmentsFromAIResponse(aiResp: {
  content: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
}): any[] | null {
  const firstTool = aiResp.toolCalls?.[0];
  if (firstTool?.function?.arguments) {
    const parsedArgs = safeParse(firstTool.function.arguments);
    if (Array.isArray(parsedArgs)) return parsedArgs as any[];
    const wrapped = (parsedArgs as any)?.enrichments;
    if (Array.isArray(wrapped)) return wrapped as any[];
  }
  return parseEnrichmentsFromRaw(aiResp.content);
}

/* ── Profession prompt builder ── */

function buildAcademicPrompt(programTitle: string): string {
  return `Du bist Hochschuldozent für "${programTitle}" und bereitest Studierende auf Klausuren vor.

AUFGABE: Erstelle fachspezifische Enrichments die EXAKT zum akademischen Kontext von "${programTitle}" passen.
- Misconceptions: Typische Denkfehler die in Klausuren und Prüfungen vorkommen
- Transfer-Kontexte: Reale Anwendungskontexte in Forschung, Wirtschaft und Praxis
- Handlungssituationen: Authentische Fallanalysen und Transferaufgaben
- Verwende korrekte wissenschaftliche Fachsprache
- Fokus auf kritische Analyse, Modellvergleiche und Transferleistungen
- KEINE berufsschulspezifischen Referenzen — alles muss akademisch fundiert sein`;
}

function buildProfessionPrompt(
  berufKurz: string,
  berufLang: string | null,
  taetigkeitsprofil: string | null,
  zustaendigkeit: string,
): string {
  // Academic fallback: no profession → use academic prompt
  if (zustaendigkeit === "Hochschule") {
    return buildAcademicPrompt(berufKurz);
  }

  const berufName = berufLang || berufKurz;
  const examMap: Record<string, string> = {
    IHK: "IHK-Abschlussprüfung",
    HWK: "Gesellenprüfung (Handwerkskammer)",
    LWK: "Prüfung der Landwirtschaftskammer",
  };
  const examType = examMap[zustaendigkeit] || `${zustaendigkeit}-Abschlussprüfung`;
  const profil = taetigkeitsprofil
    ? `\nTÄTIGKEITSPROFIL: ${taetigkeitsprofil}`
    : "";

  return `Du bist Prüfungsexperte für "${berufName}" (${examType}).${profil}

AUFGABE: Erstelle berufsspezifische Enrichments die EXAKT zum Berufsalltag von ${berufKurz} passen.
- Misconceptions: Typische Denkfehler die in der ${examType} vorkommen
- Transfer-Kontexte: Reale Einsatzgebiete dieses Berufs
- Handlungssituationen: Authentische betriebliche Szenarien
- Verwende korrekte Fachsprache des Berufsfelds
- KEINE generischen Beispiele — alles muss spezifisch für "${berufKurz}" sein`;
}

/* ── Main handler ── */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "public" }, global: { headers: { "x-statement-timeout": "25000" } } },
  );

  bootstrapLLMLogging(sb, "mass_enrich_competencies");
  const body = await req.json().catch(() => ({}));
  const COMP_BATCH = Math.min(body.batch_size || 6, 8); // 6 default for higher throughput
  const MAX_CURRICULA = Math.min(body.max_curricula || 5, 6); // 5 curricula per invocation
  const TIME_BUDGET_MS = 50_000; // 50s safe budget (leave margin for DB)
  const startTime = Date.now();
  const targetCurriculumIds: string[] | undefined = body.curriculum_ids;

  try {
    // ── 1. Get next unenriched curricula via RPC (fast, indexed) ──
    let curricula: any[];
    if (targetCurriculumIds?.length) {
      // Targeted mode: build curriculum data directly via SQL
      const targetResults: any[] = [];
      for (const cid of targetCurriculumIds) {
        const { data: cData } = await sb
          .from("curricula")
          .select("id, beruf_id")
          .eq("id", cid)
          .single();
        if (!cData) continue;
        const { data: beruf } = await sb
          .from("berufe")
          .select("bezeichnung_kurz, bezeichnung_lang, taetigkeitsprofil, zustaendigkeit")
          .eq("id", cData.beruf_id)
          .single();
        if (!beruf) continue;
        // Count unenriched
        const { data: countData } = await sb.rpc(
          "count_unenriched_competencies_for_curriculum",
          { p_curriculum_id: cid },
        );
        const unenriched = countData ?? 0;
        if (unenriched === 0) continue;
        targetResults.push({
          curriculum_id: cid,
          beruf_kurz: beruf.bezeichnung_kurz,
          beruf_lang: beruf.bezeichnung_lang,
          taetigkeitsprofil: beruf.taetigkeitsprofil,
          zustaendigkeit: beruf.zustaendigkeit,
          unenriched_count: unenriched,
        });
      }
      curricula = targetResults;
    } else {
      const { data, error: rpcErr } = await sb.rpc(
        "get_unenriched_curricula_batch",
        { p_limit: MAX_CURRICULA },
      );
      if (rpcErr) {
        console.error(`[MassEnrich] RPC error: ${rpcErr.message}`);
        return json({ ok: false, error: rpcErr.message }, 500);
      }
      curricula = data || [];
    }

    if (!curricula?.length) {
      return json({
        ok: true,
        done: true,
        message: "All competencies across all curricula are enriched!",
      });
    }

    const results: Array<{
      curriculum_id: string;
      beruf: string;
      enriched: number;
      skipped: number;
      remaining: number;
    }> = [];

    for (const cur of curricula) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;

      // ── 2. Get unenriched competencies via RPC (no nested joins) ──
      const { data: comps, error: compErr } = await sb.rpc(
        "get_unenriched_competencies_for_curriculum",
        { p_curriculum_id: cur.curriculum_id, p_limit: COMP_BATCH },
      );

      if (compErr || !comps?.length) {
        results.push({
          curriculum_id: cur.curriculum_id,
          beruf: cur.beruf_kurz,
          enriched: 0,
          skipped: 0,
          remaining: 0,
        });
        continue;
      }

      // ── 3. Build profession-specific prompt ──
      const profContext = buildProfessionPrompt(
        cur.beruf_kurz,
        cur.beruf_lang,
        cur.taetigkeitsprofil,
        cur.zustaendigkeit,
      );

      const compList = comps.map((c: any) => ({
        id: c.id,
        title: c.title,
        bloom_level: c.bloom_level,
        action_verb: c.action_verb,
        tier: c.exam_relevance_tier,
        lf_title: c.learning_field_title,
      }));

      const systemPrompt = `${profContext}

Erstelle für JEDE Kompetenz:
1. "context_conditions": Konkrete berufliche Handlungssituation (1-2 Sätze, min 30 Zeichen).
2. "misconceptions": Array von 3-5 typischen Prüfungsfehlern:
   {"claim":"...(min 10)","why_wrong":"...(min 10)","correct_principle":"...(min 10)","quick_fix":"...(min 5)","example_trap":"...(min 20)"}
3. "transfer_markers": Array von 2-3 Transfer-Kontexten:
   {"context":"...(min 10)","what_changes":"...(min 5)","what_stays":"...(min 5)","cue_words":["2-6 Wörter"]}

Antworte NUR als JSON: {"enrichments": [{id, context_conditions, misconceptions, transfer_markers}]}`;

      try {
        let enriched = 0;
        let skipped = 0;

        const applyEnrichments = async (enrichments: any[]) => {
          for (const e of enrichments) {
            if (!e?.id) {
              skipped++;
              continue;
            }
            const update: Record<string, any> = {};
            let valid = false;

            if (
              typeof e.context_conditions === "string" &&
              e.context_conditions.length >= 30
            ) {
              update.context_conditions = e.context_conditions;
              valid = true;
            }
            if (Array.isArray(e.misconceptions)) {
              const good = e.misconceptions.filter(validateMisconception);
              if (good.length >= 2) {
                update.typical_misconceptions = good;
                valid = true;
              }
            }
            if (Array.isArray(e.transfer_markers)) {
              const good = e.transfer_markers.filter(validateTransferMarker);
              if (good.length >= 1) {
                update.transfer_markers = good;
                valid = true;
              }
            }

            if (valid) {
              update.enrichment_version = 2;
              update.enriched_at = new Date().toISOString();
              const { error: upErr } = await sb
                .from("competencies")
                .update(update)
                .eq("id", e.id);
              if (!upErr) enriched++;
              else skipped++;
            } else {
              skipped++;
            }
          }
        };

        const enrichChain = await getModelChainAsync("blooms_classify");
        const aiResp = await callAIWithFailover(
          enrichChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: `${systemPrompt}\n\nHalte die Ausgabe kompakt und valide JSON-only.` },
              {
                role: "user",
                content: `Enriche diese ${comps.length} Kompetenzen für "${cur.beruf_kurz}":\n${JSON.stringify(compList)}`,
              },
            ],
            tools: [ENRICHMENT_TOOL],
            tool_choice: { type: "function", function: { name: "submit_enrichments" } },
            max_tokens: Math.max(5000, comps.length * 1100),
            timeout_ms: 22_000,
          },
        );

        let enrichments = parseEnrichmentsFromAIResponse(aiResp);

        // Deterministic fallback: if batch output is truncated/invalid, process competency-by-competency
        if (!enrichments) {
          console.warn(
            `[MassEnrich] Batch parse fail for ${cur.beruf_kurz} → fallback single-item mode: ${aiResp.content.slice(0, 200)}`,
          );

          for (const single of compList) {
            if (Date.now() - startTime > TIME_BUDGET_MS) break;
            try {
              const singleResp = await callAIWithFailover(
                enrichChain.map(c => ({ provider: c.provider, model: c.model })),
                {
                  messages: [
                    { role: "system", content: `${systemPrompt}\n\nGib genau 1 Enrichment-Objekt zurück, nur JSON.` },
                    {
                      role: "user",
                      content: `Enriche genau diese eine Kompetenz für "${cur.beruf_kurz}":\n${JSON.stringify([single])}`,
                    },
                  ],
                  tools: [ENRICHMENT_TOOL],
                  tool_choice: { type: "function", function: { name: "submit_enrichments" } },
                  max_tokens: 2600,
                  timeout_ms: 16_000,
                },
              );

              const singleEnrichments = parseEnrichmentsFromAIResponse(singleResp);
              if (!singleEnrichments?.length) {
                skipped++;
                console.warn(`[MassEnrich] Single-item parse fail ${cur.beruf_kurz} comp=${single.id?.slice?.(0, 8) || single.id}`);
                continue;
              }

              await applyEnrichments(singleEnrichments.slice(0, 1));
            } catch (singleErr) {
              skipped++;
              console.warn(`[MassEnrich] Single-item fallback error for ${cur.beruf_kurz}: ${(singleErr as Error).message}`);
            }
          }
        } else {
          await applyEnrichments(enrichments);
        }

        // ── 4. Fast remaining count via RPC ──
        const { data: remaining } = await sb.rpc(
          "count_unenriched_competencies_for_curriculum",
          { p_curriculum_id: cur.curriculum_id },
        );

        results.push({
          curriculum_id: cur.curriculum_id,
          beruf: cur.beruf_kurz,
          enriched,
          skipped,
          remaining: remaining ?? Math.max(0, cur.unenriched_count - enriched),
        });
      } catch (aiErr) {
        console.error(
          `[MassEnrich] AI error for ${cur.beruf_kurz}: ${(aiErr as Error).message}`,
        );
        results.push({
          curriculum_id: cur.curriculum_id,
          beruf: cur.beruf_kurz,
          enriched: 0,
          skipped: comps.length,
          remaining: cur.unenriched_count,
        });
      }
    }

    const totalEnriched = results.reduce((s, r) => s + r.enriched, 0);

    return json({
      ok: true,
      enriched_total: totalEnriched,
      curricula_processed: results.length,
      results,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error(`[MassEnrich] Fatal: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
