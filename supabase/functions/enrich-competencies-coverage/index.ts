import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Phase 1: Deterministic + AI-assisted coverage enrichment
 * 
 * 1. bloom_level: Fill from taxonomy_level mapping or AI extraction
 * 2. exam_relevance_tier: Derive from exam_part + position
 * 3. action_verb: Extract from title/description (AI-assisted)
 * 
 * Runs in batches. Designed to be called repeatedly until all done.
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
  "erinnern": "remember",
  "wissen": "remember",
  "kennen": "remember",
  "verstehen": "understand",
  "nachvollziehen": "understand",
  "anwenden": "apply",
  "planen": "apply",
  "durchführen": "apply",
  "analysieren": "analyze",
  "untersuchen": "analyze",
  "bewerten": "evaluate",
  "beurteilen": "evaluate",
  "evaluieren": "evaluate",
  "gestalten": "create",
  "entwickeln": "create",
  "entwerfen": "create",
  "synthese": "create",
  "synthetisieren": "create",
};

// Verb-to-bloom mapping for extraction from titles
const VERB_BLOOM_MAP: Record<string, string> = {
  "kennt": "remember", "nennt": "remember", "beschreibt": "understand", "erläutert": "understand",
  "erklärt": "understand", "vergleicht": "analyze", "unterscheidet": "analyze",
  "wendet an": "apply", "berechnet": "apply", "plant": "apply", "führt durch": "apply",
  "erstellt": "apply", "konfiguriert": "apply", "installiert": "apply",
  "analysiert": "analyze", "untersucht": "analyze", "prüft": "analyze",
  "bewertet": "evaluate", "beurteilt": "evaluate", "wählt aus": "evaluate",
  "entwickelt": "create", "entwirft": "create", "gestaltet": "create", "optimiert": "create",
};

function inferBloomFromText(title: string, desc: string): string | null {
  const text = `${title} ${desc}`.toLowerCase();
  for (const [verb, bloom] of Object.entries(VERB_BLOOM_MAP)) {
    if (text.includes(verb)) return bloom;
  }
  // Fallback heuristic
  if (text.match(/kennt|weiß|nennt|gibt an|zählt auf/)) return "remember";
  if (text.match(/versteht|beschreibt|erläutert|erklärt/)) return "understand";
  if (text.match(/wendet|berechnet|plant|erstellt|führt|konfiguriert/)) return "apply";
  if (text.match(/analysiert|vergleicht|untersucht|prüft/)) return "analyze";
  if (text.match(/bewertet|beurteilt|entscheidet/)) return "evaluate";
  if (text.match(/entwickelt|entwirft|gestaltet|konstruiert/)) return "create";
  return "understand"; // safe default
}

function extractActionVerb(title: string, desc: string): string | null {
  const text = `${title} ${desc}`.toLowerCase();
  // Extract first strong verb
  const verbPatterns = [
    /(?:der|die|das)\s+\w+\s+([\wäöüß]+t)\b/,
    /\b([\wäöüß]+(?:iert|iert|elt|ert|etzt|ennt|innt))\b/,
    /\b(berechnet|konfiguriert|analysiert|bewertet|plant|erstellt|prüft|ermittelt|entwickelt|gestaltet|installiert|dokumentiert|vergleicht|unterscheidet|beurteilt|optimiert)\b/,
  ];
  for (const p of verbPatterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const maxItems = body.max_items || BATCH_SIZE * 3;

  try {
    // ═══════════════════════════════════════
    // STEP 1: Bloom-Level Coverage (deterministic)
    // ═══════════════════════════════════════
    let bloomFilled = 0;

    // 1a) Fill from taxonomy_level
    const { data: noBloom } = await sb
      .from("competencies")
      .select("id, title, description, taxonomy_level")
      .is("bloom_level", null)
      .limit(maxItems);

    if (noBloom?.length) {
      for (const comp of noBloom) {
        let bloom: string | null = null;

        // Try taxonomy_level mapping first
        if (comp.taxonomy_level) {
          const key = comp.taxonomy_level.toLowerCase().trim();
          bloom = TAXONOMY_TO_BLOOM[key] || null;
        }

        // Fallback: infer from text
        if (!bloom) {
          bloom = inferBloomFromText(comp.title || "", comp.description || "");
        }

        if (bloom) {
          const { error } = await sb
            .from("competencies")
            .update({ bloom_level: bloom, bloom_inferred: !comp.taxonomy_level })
            .eq("id", comp.id);
          if (!error) bloomFilled++;
        }
      }
    }

    // ═══════════════════════════════════════
    // STEP 2: exam_relevance_tier (deterministic from LF context)
    // ═══════════════════════════════════════
    let tierFilled = 0;

    const { data: noTier } = await sb
      .from("competencies")
      .select("id, title, learning_field_id, bloom_level")
      .is("exam_relevance_tier", null)
      .limit(maxItems);

    if (noTier?.length) {
      // Load LF context
      const lfIds = [...new Set(noTier.map(c => c.learning_field_id))];
      const { data: lfs } = await sb
        .from("learning_fields")
        .select("id, exam_part, weight_percent, hours")
        .in("id", lfIds);

      const lfMap = new Map((lfs || []).map(lf => [lf.id, lf]));

      for (const comp of noTier) {
        const lf = lfMap.get(comp.learning_field_id);
        let tier = "important"; // default

        if (lf) {
          // High weight or AP1 → core
          if ((lf.weight_percent && lf.weight_percent >= 15) || lf.exam_part === "AP1") {
            tier = "core";
          }
          // Low weight → supplementary
          if (lf.weight_percent && lf.weight_percent < 5) {
            tier = "supplementary";
          }
          // High bloom + high weight → definitely core
          if (comp.bloom_level && ["analyze", "evaluate", "create"].includes(comp.bloom_level)
            && lf.weight_percent && lf.weight_percent >= 10) {
            tier = "core";
          }
        }

        const { error } = await sb
          .from("competencies")
          .update({ exam_relevance_tier: tier })
          .eq("id", comp.id);
        if (!error) tierFilled++;
      }
    }

    // ═══════════════════════════════════════
    // STEP 3: action_verb extraction (deterministic + AI fallback)
    // ═══════════════════════════════════════
    let verbFilled = 0;

    const { data: noVerb } = await sb
      .from("competencies")
      .select("id, title, description")
      .is("action_verb", null)
      .limit(maxItems);

    if (noVerb?.length) {
      // First pass: deterministic extraction
      const needsAI: typeof noVerb = [];

      for (const comp of noVerb) {
        const verb = extractActionVerb(comp.title || "", comp.description || "");
        if (verb) {
          const { error } = await sb
            .from("competencies")
            .update({ action_verb: verb })
            .eq("id", comp.id);
          if (!error) verbFilled++;
        } else {
          needsAI.push(comp);
        }
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
Verwende die 3. Person Singular (z.B. "berechnet", "analysiert", "konfiguriert").`,
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

          for (const v of verbs) {
            if (v.id && v.verb) {
              const { error } = await sb
                .from("competencies")
                .update({ action_verb: v.verb })
                .eq("id", v.id);
              if (!error) verbFilled++;
            }
          }
        } catch (e) {
          console.warn(`[Phase1] AI verb extraction failed: ${(e as Error).message}`);
        }
      }
    }

    // ═══════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════
    // Count remaining gaps
    const { count: missingBloom } = await sb
      .from("competencies").select("id", { count: "exact", head: true }).is("bloom_level", null);
    const { count: missingTier } = await sb
      .from("competencies").select("id", { count: "exact", head: true }).is("exam_relevance_tier", null);
    const { count: missingVerb } = await sb
      .from("competencies").select("id", { count: "exact", head: true }).is("action_verb", null);

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
