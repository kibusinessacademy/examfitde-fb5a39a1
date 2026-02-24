import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Phase 1: Deterministic + AI-assisted coverage enrichment
 * 
 * Uses RPC get_phase1_candidates for proper curriculum filtering.
 * Batch upserts instead of N+1 updates.
 * No fake bloom defaults — null + flagged if not inferrable.
 */

const BATCH_SIZE = 50;
const AI_BATCH = 20;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Deterministic bloom mapping from German taxonomy labels
const TAXONOMY_TO_BLOOM: Record<string, string> = {
  "erinnern": "remember", "wissen": "remember", "kennen": "remember",
  "verstehen": "understand", "nachvollziehen": "understand",
  "anwenden": "apply", "planen": "apply", "durchführen": "apply",
  "analysieren": "analyze", "untersuchen": "analyze",
  "bewerten": "evaluate", "beurteilen": "evaluate", "evaluieren": "evaluate",
  "gestalten": "create", "entwickeln": "create", "entwerfen": "create",
  "synthese": "create", "synthetisieren": "create",
};

// Verb-to-bloom mapping for extraction from titles
const VERB_BLOOM_MAP: Record<string, string> = {
  "kennt": "remember", "nennt": "remember", "beschreibt": "understand",
  "erläutert": "understand", "erklärt": "understand",
  "vergleicht": "analyze", "unterscheidet": "analyze",
  "wendet an": "apply", "berechnet": "apply", "plant": "apply",
  "führt durch": "apply", "erstellt": "apply", "konfiguriert": "apply",
  "installiert": "apply", "analysiert": "analyze", "untersucht": "analyze",
  "prüft": "analyze", "bewertet": "evaluate", "beurteilt": "evaluate",
  "wählt aus": "evaluate", "entwickelt": "create", "entwirft": "create",
  "gestaltet": "create", "optimiert": "create",
};

// ❌ Bug 3 Fix: Stop verbs that are NOT action verbs
const STOP_VERBS = new Set([
  "ist", "wird", "hat", "kann", "soll", "muss", "darf",
  "enthält", "umfasst", "gibt", "macht", "geht", "steht",
  "liegt", "bleibt", "lässt", "kommt", "stellt", "nimmt",
  "sieht", "findet", "braucht", "heißt", "weiß", "hält",
  "bringt", "führt", "gilt", "spricht", "gehört", "läuft",
  "zeigt", "bedeutet", "scheint", "liest", "schreibt",
]);

// Whitelist of strong action verbs
const ACTION_VERB_WHITELIST = new Set([
  "berechnet", "konfiguriert", "analysiert", "bewertet", "plant",
  "erstellt", "prüft", "ermittelt", "entwickelt", "gestaltet",
  "installiert", "dokumentiert", "vergleicht", "unterscheidet",
  "beurteilt", "optimiert", "implementiert", "programmiert",
  "testet", "validiert", "migriert", "administriert", "deployt",
  "sichert", "verschlüsselt", "automatisiert", "diagnostiziert",
  "repariert", "wartet", "kalibriert", "konstruiert", "fertigt",
  "montiert", "demontiert", "lötet", "verdrahtet", "misst",
  "dimensioniert", "projektiert", "kalkuliert", "bilanziert",
  "kontiert", "bucht", "fakturiert", "disponiert", "kommissioniert",
  "berät", "verkauft", "präsentiert", "moderiert", "schult",
  "evaluiert", "auditiert", "zertifiziert", "normiert",
]);

function inferBloomFromText(title: string, desc: string): { bloom: string | null; source: string } {
  const text = `${title} ${desc}`.toLowerCase();
  
  for (const [verb, bloom] of Object.entries(VERB_BLOOM_MAP)) {
    if (text.includes(verb)) return { bloom, source: "text_heuristic" };
  }
  
  // Regex fallbacks
  if (text.match(/kennt|weiß|nennt|gibt an|zählt auf/)) return { bloom: "remember", source: "text_heuristic" };
  if (text.match(/versteht|beschreibt|erläutert|erklärt/)) return { bloom: "understand", source: "text_heuristic" };
  if (text.match(/wendet|berechnet|plant|erstellt|führt|konfiguriert/)) return { bloom: "apply", source: "text_heuristic" };
  if (text.match(/analysiert|vergleicht|untersucht|prüft/)) return { bloom: "analyze", source: "text_heuristic" };
  if (text.match(/bewertet|beurteilt|entscheidet/)) return { bloom: "evaluate", source: "text_heuristic" };
  if (text.match(/entwickelt|entwirft|gestaltet|konstruiert/)) return { bloom: "create", source: "text_heuristic" };
  
  // ❌ Bug 3 Fix: NO fake default — return null
  return { bloom: null, source: "unknown" };
}

function extractActionVerb(title: string, desc: string): string | null {
  const text = `${title} ${desc}`.toLowerCase();
  
  // ❌ Bug 2 Fix: Check whitelist FIRST (highest quality)
  for (const verb of ACTION_VERB_WHITELIST) {
    if (text.includes(verb)) return verb;
  }
  
  // Pattern: conjugated verbs ending in -iert, -elt, -ert, -etzt
  const m = text.match(/\b([\wäöüß]+(?:iert|elt|ert|etzt))\b/);
  if (m && !STOP_VERBS.has(m[1])) return m[1];
  
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Security gate: require job key
  const jobKey = req.headers.get("x-examfit-job-key");
  const expectedKey = Deno.env.get("CRON_SECRET");
  if (!expectedKey || jobKey !== expectedKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id || null;
  const maxItems = body.max_items || BATCH_SIZE * 3;

  try {
    // ═══════════════════════════════════════
    // STEP 1: Bloom-Level Coverage
    // ❌ Bug 1 Fix: Uses RPC with curriculum filter
    // ═══════════════════════════════════════
    let bloomFilled = 0;
    const bloomUpdates: Array<{ id: string; bloom_level: string; bloom_inferred: boolean; bloom_source: string }> = [];

    const { data: noBloom } = await sb.rpc("get_phase1_candidates", {
      p_curriculum_id: curriculumId,
      p_field: "bloom_level",
      p_limit: maxItems,
    });

    if (noBloom?.length) {
      for (const comp of noBloom) {
        let bloom: string | null = null;
        let source = "unknown";

        // Try taxonomy_level mapping first
        if (comp.taxonomy_level) {
          const key = comp.taxonomy_level.toLowerCase().trim();
          bloom = TAXONOMY_TO_BLOOM[key] || null;
          if (bloom) source = "taxonomy";
        }

        // Fallback: infer from text
        if (!bloom) {
          const result = inferBloomFromText(comp.title || "", comp.description || "");
          bloom = result.bloom;
          source = result.source;
        }

        if (bloom) {
          bloomUpdates.push({
            id: comp.id,
            bloom_level: bloom,
            bloom_inferred: source !== "taxonomy",
            bloom_source: source,
          });
        }
        // ❌ Bug 3 Fix: if bloom is null, we DON'T write — it stays null
      }

      // ⚠️ Performance Fix: batch upsert instead of N+1
      if (bloomUpdates.length) {
        const { error } = await sb
          .from("competencies")
          .upsert(bloomUpdates, { onConflict: "id", ignoreDuplicates: false });
        if (!error) bloomFilled = bloomUpdates.length;
        else console.error(`[Phase1] Bloom upsert error: ${error.message}`);
      }
    }

    // ═══════════════════════════════════════
    // STEP 2: exam_relevance_tier
    // ═══════════════════════════════════════
    let tierFilled = 0;
    const tierUpdates: Array<{ id: string; exam_relevance_tier: string }> = [];

    const { data: noTier } = await sb.rpc("get_phase1_candidates", {
      p_curriculum_id: curriculumId,
      p_field: "exam_relevance_tier",
      p_limit: maxItems,
    });

    if (noTier?.length) {
      for (const comp of noTier) {
        let tier = "important"; // default for unknown

        if (comp.weight_percent !== null && comp.weight_percent !== undefined) {
          if (comp.weight_percent >= 15 || comp.exam_part === "AP1") {
            tier = "core";
          }
          if (comp.weight_percent < 5) {
            tier = "supplementary";
          }
          if (comp.bloom_level && ["analyze", "evaluate", "create"].includes(comp.bloom_level)
            && comp.weight_percent >= 10) {
            tier = "core";
          }
        }

        tierUpdates.push({ id: comp.id, exam_relevance_tier: tier });
      }

      if (tierUpdates.length) {
        const { error } = await sb
          .from("competencies")
          .upsert(tierUpdates, { onConflict: "id", ignoreDuplicates: false });
        if (!error) tierFilled = tierUpdates.length;
        else console.error(`[Phase1] Tier upsert error: ${error.message}`);
      }
    }

    // ═══════════════════════════════════════
    // STEP 3: action_verb extraction
    // ═══════════════════════════════════════
    let verbFilled = 0;

    const { data: noVerb } = await sb.rpc("get_phase1_candidates", {
      p_curriculum_id: curriculumId,
      p_field: "action_verb",
      p_limit: maxItems,
    });

    if (noVerb?.length) {
      // First pass: deterministic extraction
      const deterministicUpdates: Array<{ id: string; action_verb: string }> = [];
      const needsAI: typeof noVerb = [];

      for (const comp of noVerb) {
        const verb = extractActionVerb(comp.title || "", comp.description || "");
        if (verb) {
          deterministicUpdates.push({ id: comp.id, action_verb: verb });
        } else {
          needsAI.push(comp);
        }
      }

      // Batch upsert deterministic
      if (deterministicUpdates.length) {
        const { error } = await sb
          .from("competencies")
          .upsert(deterministicUpdates, { onConflict: "id", ignoreDuplicates: false });
        if (!error) verbFilled += deterministicUpdates.length;
      }

      // Second pass: AI extraction for remaining (in batches)
      for (let i = 0; i < needsAI.length && i < AI_BATCH * 3; i += AI_BATCH) {
        const batch = needsAI.slice(i, i + AI_BATCH);
        try {
          const aiResp = await callAIJSON({
            provider: "lovable",
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `Extrahiere das zentrale Handlungsverb aus Kompetenzformulierungen.
Antworte NUR als JSON: {"verbs": [{"id": "uuid", "verb": "handlungsverb"}]}
Verwende die 3. Person Singular (z.B. "berechnet", "analysiert", "konfiguriert").
NICHT verwenden: ist, wird, hat, kann, soll, muss, darf, enthält, umfasst.`,
              },
              {
                role: "user",
                content: JSON.stringify(batch.map(c => ({ id: c.id, title: c.title, desc: (c.description || "").slice(0, 100) }))),
              },
            ],
            max_tokens: 1024,
          });

          const parsed = JSON.parse(
            aiResp.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
          );
          const verbs = Array.isArray(parsed) ? parsed : (parsed.verbs || []);

          const aiUpdates: Array<{ id: string; action_verb: string; action_verb_source: string }> = [];
          const VERB_RE = /^[a-zäöüß]+$/;
          for (const v of verbs) {
            const verb = (v.verb || "").toLowerCase().trim();
            if (!v.id || !verb) continue;
            if (STOP_VERBS.has(verb)) continue;
            if (verb.length < 4 || verb.length > 30) continue;
            if (!VERB_RE.test(verb)) continue;
            const source = ACTION_VERB_WHITELIST.has(verb) ? "ai_verified" : "ai_unverified";
            aiUpdates.push({ id: v.id, action_verb: verb, action_verb_source: source });
          }

          if (aiUpdates.length) {
            const { error } = await sb
              .from("competencies")
              .upsert(aiUpdates, { onConflict: "id", ignoreDuplicates: false });
            if (!error) verbFilled += aiUpdates.length;
          }
        } catch (e) {
          console.warn(`[Phase1] AI verb extraction failed: ${(e as Error).message}`);
        }
      }
    }

    // ═══════════════════════════════════════
    // SUMMARY — curriculum-scoped remaining counts
    // ═══════════════════════════════════════
    let missingBloom: number | null = 0;
    let missingTier: number | null = 0;
    let missingVerb: number | null = 0;

    if (curriculumId) {
      // Scoped counts via RPC (returns 0 candidates = 0 remaining)
      const { data: rb } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "bloom_level", p_limit: 1 });
      const { data: rt } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "exam_relevance_tier", p_limit: 1 });
      const { data: rv } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "action_verb", p_limit: 1 });
      // Use RPC with limit 10000 for accurate count when scoped
      const { data: rbAll } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "bloom_level", p_limit: 10000 });
      const { data: rtAll } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "exam_relevance_tier", p_limit: 10000 });
      const { data: rvAll } = await sb.rpc("get_phase1_candidates", { p_curriculum_id: curriculumId, p_field: "action_verb", p_limit: 10000 });
      missingBloom = rbAll?.length ?? 0;
      missingTier = rtAll?.length ?? 0;
      missingVerb = rvAll?.length ?? 0;
    } else {
      // Global counts
      const { count: mb } = await sb.from("competencies").select("id", { count: "exact", head: true }).is("bloom_level", null);
      const { count: mt } = await sb.from("competencies").select("id", { count: "exact", head: true }).is("exam_relevance_tier", null);
      const { count: mv } = await sb.from("competencies").select("id", { count: "exact", head: true }).is("action_verb", null);
      missingBloom = mb; missingTier = mt; missingVerb = mv;
    }

    const summary = {
      ok: true,
      phase: 1,
      bloom_filled: bloomFilled,
      tier_filled: tierFilled,
      verb_filled: verbFilled,
      remaining: {
        bloom: missingBloom || 0,
        exam_tier: missingTier || 0,
        action_verb: missingVerb || 0,
      },
      batch_complete: (missingBloom || 0) === 0 && (missingTier || 0) === 0 && (missingVerb || 0) <= 500,
    };

    console.log(`[Phase1] bloom+${bloomFilled} tier+${tierFilled} verb+${verbFilled} | remaining: bloom=${missingBloom} tier=${missingTier} verb=${missingVerb}`);
    return json(summary);

  } catch (e) {
    console.error(`[Phase1] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
