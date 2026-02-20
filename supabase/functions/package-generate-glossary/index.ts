import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadOrGenerateGlossary } from "../_shared/glossary-loader.ts";
import { logLLMCostEvent } from "../_shared/ai-client.ts";

/**
 * package-generate-glossary — Pipeline Step (pre-warm)
 *
 * Generates and caches the profession-specific glossary BEFORE
 * generate_learning_content runs. This ensures the content generator
 * only does a fast cache read instead of a slow LLM call.
 *
 * This step is idempotent: if glossary already cached, it returns immediately.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  // Resolve beruf_id and profession name
  const { data: cu } = await sb
    .from("curricula")
    .select("beruf_id, berufe(bezeichnung_kurz)")
    .eq("id", curriculumId)
    .maybeSingle();

  const berufId = cu?.beruf_id;
  const professionName = (cu as any)?.berufe?.bezeichnung_kurz || "Unbekannt";

  if (!berufId) {
    console.log("[gen-glossary] No beruf_id found — skipping glossary generation");
    return json({ ok: true, skipped: true, reason: "no_beruf_id" });
  }

  // Check if already cached
  const { data: cached } = await sb
    .from("profession_glossaries")
    .select("id, version")
    .eq("beruf_id", berufId)
    .limit(1)
    .maybeSingle();

  if (cached) {
    console.log(`[gen-glossary] Glossary already cached for "${professionName}" — skipping`);
    return json({ ok: true, skipped: true, reason: "already_cached", version: cached.version });
  }

  // Generate (this is the slow LLM call — we have full edge function runtime here)
  console.log(`[gen-glossary] Generating glossary for "${professionName}"...`);
  const startMs = Date.now();

  try {
    const glossary = await loadOrGenerateGlossary(sb, berufId, professionName, curriculumId);
    const durationMs = Date.now() - startMs;

    const termCount = glossary.fachbegriffe
      ? Object.values(glossary.fachbegriffe).reduce((sum, terms) => sum + (terms as string[]).length, 0)
      : 0;

    console.log(`[gen-glossary] ✅ Glossary generated for "${professionName}" in ${durationMs}ms (${termCount} terms)`);

    return json({
      ok: true,
      batch_complete: true,
      profession: professionName,
      term_count: termCount,
      duration_ms: durationMs,
    });
  } catch (e) {
    const errMsg = (e as Error).message || String(e);
    console.error(`[gen-glossary] ❌ Failed: ${errMsg}`);
    return json({ error: errMsg }, 500);
  }
});
