import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { loadOrGenerateGlossary } from "../_shared/glossary-loader.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-generate-glossary — Pipeline Step (pre-warm)
 *
 * Generates and caches the profession-specific glossary BEFORE
 * generate_learning_content runs.
 *
 * FAIL-SOFT: If generation fails after max attempts, returns
 * batch_complete: true so the pipeline continues without glossary.
 * Glossary is optional enrichment, not a hard gate.
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
  const jobId = p.job_id;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  // Resolve beruf_id, profession name, and track
  const { data: cu } = await sb
    .from("curricula")
    .select("beruf_id, berufe(bezeichnung_kurz)")
    .eq("id", curriculumId)
    .maybeSingle();

  // Resolve track from package
  const { data: pkgRow } = await sb
    .from("course_packages")
    .select("track")
    .eq("id", packageId)
    .maybeSingle();
  const track = pkgRow?.track || "AUSBILDUNG_VOLL";

  const berufId = cu?.beruf_id;
  const professionName = (cu as any)?.berufe?.bezeichnung_kurz || "Unbekannt";

  if (!berufId) {
    console.log("[gen-glossary] No beruf_id found — skipping (fail-soft)");
    await finalizeStepDone(sb, packageId, "generate_glossary", { skipped: true, reason: "no_beruf_id" });
    return json({ ok: true, batch_complete: true, skipped: true, reason: "no_beruf_id" });
  }

  // Check if already cached AND substantive (entries + token_count >= post-condition thresholds)
  const { data: cached } = await sb
    .from("profession_glossaries")
    .select("id, version, glossary, token_count")
    .eq("beruf_id", berufId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Hollow-Cache Detection: post-condition requires entryCount >= 1 AND tokenCount >= 100
  // (see _shared/post-conditions-extended.ts line 113). If cache is hollow → regenerate.
  function isCacheHollow(row: any): boolean {
    if (!row) return true;
    const tokenCount = Number(row.token_count ?? 0);
    if (tokenCount < 100) return true;
    const g = row.glossary;
    if (!g || typeof g !== "object") return true;
    // Count substantive content: terms + formulas + traps + scenarios + calculations
    const terms = g.fachbegriffe ? Object.values(g.fachbegriffe).reduce((s: number, arr: any) => s + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    const formulas = Array.isArray(g.formeln) ? g.formeln.length : 0;
    const traps = Array.isArray(g.pruefungsfallen) ? g.pruefungsfallen.length : 0;
    const scenarios = Array.isArray(g.szenarien) ? g.szenarien.length : 0;
    const calcs = Array.isArray(g.rechenbeispiele) ? g.rechenbeispiele.length : 0;
    const totalEntries = terms + formulas + traps + scenarios + calcs;
    return totalEntries < 10; // less than 10 substantive items = hollow
  }

  if (cached && !isCacheHollow(cached)) {
    console.log(`[gen-glossary] Substantive cache hit for "${professionName}" v${cached.version} (tokens=${cached.token_count}) — skipping`);
    await finalizeStepDone(sb, packageId, "generate_glossary", { skipped: true, reason: "already_cached", version: cached.version });
    return json({ ok: true, batch_complete: true, skipped: true, reason: "already_cached", version: cached.version });
  }

  if (cached) {
    // Hollow cache → invalidate (delete) so loadOrGenerateGlossary regenerates fresh
    console.warn(`[gen-glossary] ⚠️ Hollow cache detected for "${professionName}" v${cached.version} (tokens=${cached.token_count}) — invalidating and regenerating`);
    await sb.from("profession_glossaries").delete().eq("id", cached.id);
  }

  // Generate (slow LLM call — we have full edge function runtime here)
  console.log(`[gen-glossary] Generating glossary for "${professionName}"...`);
  const startMs = Date.now();

  try {
    const glossary = await loadOrGenerateGlossary(sb, berufId, professionName, curriculumId, track);
    const durationMs = Date.now() - startMs;

    const termCount = glossary.fachbegriffe
      ? Object.values(glossary.fachbegriffe).reduce((sum, terms) => sum + (terms as string[]).length, 0)
      : 0;

    console.log(`[gen-glossary] ✅ Glossary generated for "${professionName}" in ${durationMs}ms (${termCount} terms)`);

    await finalizeStepDone(sb, packageId, "generate_glossary", { term_count: termCount, duration_ms: durationMs });

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

    // FAIL-SOFT: Glossary is optional — mark step done so pipeline continues.
    console.warn(`[gen-glossary] ⚠️ Glossary is optional — marking step done (fail-soft) to unblock pipeline`);
    await finalizeStepDone(sb, packageId, "generate_glossary", { fail_soft: true, error: errMsg });
    return json({
      ok: false,
      batch_complete: true,
      error: errMsg,
      fail_soft: true,
    });
  }
});