// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON, type AIProvider } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action || body._job_type || "run_asset";
    const assetId = body.assetId || body.asset_id;
    const round = body.round ?? 1;
    const maxRounds = body.maxRounds ?? 3;

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── SEED ASSETS ──
    if (action === "marketing_seed_assets") {
      const seeds = [
        { asset_type: "landing_page", slug: "pruefungstraining-azubis", title: "Prüfungstraining für Azubis", target_audience: "azubis", target_group: "azubis" },
        { asset_type: "landing_page", slug: "pruefungstraining-betriebe", title: "Prüfungstraining für Betriebe", target_audience: "betriebe", target_group: "betriebe" },
        { asset_type: "landing_page", slug: "pruefungstraining-institutionen", title: "Prüfungstraining für Institutionen", target_audience: "institutionen", target_group: "institutionen" },
      ];
      for (const s of seeds) { await sb.from("marketing_assets").upsert({ ...s, locale: "de-DE", status: "draft" }, { onConflict: "asset_type,slug,locale", ignoreDuplicates: true }); }
      return json({ ok: true, seeded: seeds.length });
    }

    // ── PROPOSE (OpenAI via Gateway) ──
    if (action === "marketing_propose" || action === "run_asset") {
      if (!assetId) throw new Error("assetId required");
      const { data: asset, error: aErr } = await sb.from("marketing_assets").select("*").eq("id", assetId).single();
      if (aErr || !asset) throw new Error(`Asset not found: ${aErr?.message}`);

      const ssot = await buildSSOTContext(sb, asset);
      const proposal = await callProposer(asset, ssot);

      const { data: ver, error: vErr } = await sb.from("content_versions").insert({
        course_id: asset.course_id ?? null, lesson_id: null, step_key: "marketing",
        entity_type: asset.asset_type, entity_id: asset.id, content_json: proposal,
        created_by_agent: "openai", status: "under_review", council_round: round,
      }).select("id").single();
      if (vErr) throw vErr;

      await sb.from("council_messages").insert({ content_version_id: ver!.id, agent_name: "openai-proposer", message_type: "proposal", message_json: proposal });

      if (action === "run_asset") {
        return await runCritique(sb, asset, ssot, proposal, ver!.id, round, maxRounds);
      }
      return json({ ok: true, versionId: ver!.id, phase: "proposed" });
    }

    // ── CRITIQUE (Google Gemini) ──
    if (action === "marketing_critique") {
      if (!assetId) throw new Error("assetId required");
      const versionId = body.versionId || body.version_id;
      if (!versionId) throw new Error("versionId required");

      const { data: asset } = await sb.from("marketing_assets").select("*").eq("id", assetId).single();
      if (!asset) throw new Error("Asset not found");
      const { data: ver } = await sb.from("content_versions").select("content_json").eq("id", versionId).single();
      if (!ver) throw new Error("Version not found");

      const ssot = await buildSSOTContext(sb, asset);
      return await runCritique(sb, asset, ssot, ver.content_json, versionId, round, maxRounds);
    }

    // ── REVISE (OpenAI via Gateway) ──
    if (action === "marketing_revise") {
      if (!assetId) throw new Error("assetId required");
      const versionId = body.versionId || body.version_id;
      const { data: asset } = await sb.from("marketing_assets").select("*").eq("id", assetId).single();
      if (!asset) throw new Error("Asset not found");

      const { data: msgs } = await sb.from("council_messages").select("message_json").eq("content_version_id", versionId).eq("message_type", "critique").order("created_at", { ascending: false }).limit(1);
      const critique = msgs?.[0]?.message_json || {};
      const ssot = await buildSSOTContext(sb, asset);

      const revisedProposal = await callProposer(asset, ssot, critique);

      const { data: newVer } = await sb.from("content_versions").insert({
        course_id: asset.course_id ?? null, lesson_id: null, step_key: "marketing",
        entity_type: asset.asset_type, entity_id: asset.id, content_json: revisedProposal,
        created_by_agent: "openai", status: "under_review", council_round: round,
      }).select("id").single();

      await sb.from("council_messages").insert({ content_version_id: newVer!.id, agent_name: "openai-proposer", message_type: "revision", message_json: revisedProposal });
      return json({ ok: true, versionId: newVer!.id, phase: "revised", round });
    }

    // ── PUBLISH ──
    if (action === "marketing_publish") {
      if (!assetId) throw new Error("assetId required");
      const versionId = body.versionId || body.version_id;
      if (!versionId) throw new Error("versionId required");
      const { error: pubErr } = await sb.rpc("publish_marketing_asset", { p_asset_id: assetId, p_version_id: versionId });
      if (pubErr) throw pubErr;
      return json({ ok: true, published: true, assetId, versionId });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error("marketing-council-run error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── Critique + Verdict Pipeline ──
async function runCritique(sb: ReturnType<typeof createClient>, asset: Record<string, unknown>, ssot: Record<string, unknown>, proposal: unknown, versionId: string, round: number, maxRounds: number) {
  const critiqueResult = await callAIJSON({
    provider: "lovable",
    messages: [
      { role: "system", content: buildCriticSystem() },
      { role: "user", content: buildCriticUser(asset, ssot, proposal) },
    ],
    temperature: 0.3,
  });

  let critique: Record<string, unknown> = {};
  try { const m = critiqueResult.content.match(/\{[\s\S]*\}/); critique = JSON.parse(m?.[0] || critiqueResult.content); } catch { critique = { raw: critiqueResult.content }; }

  await sb.from("council_messages").insert({ content_version_id: versionId, agent_name: "google-critic", message_type: "critique", message_json: critique });

  const decision = computeDecision(critique);

  await sb.from("council_votes").insert([
    { content_version_id: versionId, agent_name: "openai-proposer", vote: decision.finalDecision === "rejected" ? "revise" : decision.finalDecision, confidence: 0.7, rationale: "proposer self-check" },
    { content_version_id: versionId, agent_name: "google-critic", vote: decision.validatorVote, confidence: decision.consensusScore, rationale: decision.rationale || "validator assessment" },
  ]);

  await sb.from("council_verdicts").insert({ content_version_id: versionId, final_decision: decision.finalDecision, consensus_score: decision.consensusScore, required_fixes: decision.requiredFixes, decided_by: "marketing_council" });

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);
    const { error: pubErr } = await sb.rpc("publish_marketing_asset", { p_asset_id: asset.id as string, p_version_id: versionId });
    return json({ ok: true, versionId, decision, published: !pubErr });
  }
  if (decision.finalDecision === "revise" && round < maxRounds) {
    await sb.from("content_versions").update({ status: "revise" }).eq("id", versionId);
    return json({ ok: true, versionId, decision, nextRound: round + 1 });
  }
  const finalStatus = decision.finalDecision === "rejected" ? "rejected" : "revise";
  await sb.from("content_versions").update({ status: finalStatus }).eq("id", versionId);
  return json({ ok: true, versionId, decision, finalStatus });
}

// ── Gateway Helpers ──
async function callProposer(asset: Record<string, unknown>, ssot: Record<string, unknown>, critique?: unknown): Promise<unknown> {
  const userPrompt = critique
    ? `Überarbeite basierend auf dieser Kritik:\n${JSON.stringify(critique)}\n\nSSOT:\n${JSON.stringify(ssot)}`
    : `Erstelle Content für: ${asset.asset_type}\nTitel: ${asset.title}\nZielgruppe: ${asset.target_audience || asset.target_group || "allgemein"}\nSlug: ${asset.slug || "tbd"}\nSSOT-Kontext: ${JSON.stringify(ssot)}`;

  const result = await callAIJSON({
    provider: "openai",
    messages: [{ role: "system", content: buildProposerSystem() }, { role: "user", content: userPrompt }],
    temperature: 0.7,
  });
  try { return JSON.parse(result.content); } catch { return { raw: result.content }; }
}

// ── SSOT Context Builder ──
async function buildSSOTContext(sb: ReturnType<typeof createClient>, asset: Record<string, unknown>) {
  const ctx: Record<string, unknown> = {};
  if (asset.course_id) { const { data } = await sb.from("courses").select("title, description, slug, beruf_id").eq("id", asset.course_id).single(); ctx.course = data; }
  if (asset.certification_id) { const { data } = await sb.from("curricula").select("title, beruf_id").eq("id", asset.certification_id).single(); ctx.certification = data; }
  return ctx;
}

// ── Prompts ──
function buildProposerSystem() {
  return `Du bist der ExamFit Marketing Council Content-Autor.\nErzeuge ausschließlich SSOT-konformen Marketing-Content als JSON.\n\nREGELN:\n- NUR Fakten aus dem SSOT-Kontext\n- KEINE falschen Versprechen\n- KEINE IHK-offiziell Claims\n- Wording: "Prüfung starten" / "Prüfung simulieren"\n- Zielgruppen strikt trennen\n- Sprache: Deutsch (de-DE)\n\nOUTPUT FORMAT (JSON):\n{\n  "meta": { "title": "max 60 Zeichen", "description": "max 160 Zeichen" },\n  "hero": { "headline": "...", "subline": "...", "cta_text": "...", "cta_url": "..." },\n  "sections": [{ "type": "features|testimonial|faq|cta", "heading": "...", "content": "..." }],\n  "faq": [{ "q": "...", "a": "..." }],\n  "structured_data": {}\n}`;
}
function buildCriticSystem() {
  return `Du bist der ExamFit Marketing Council Validator.\nPrüfe Marketing-Content auf: Zielgruppen-Passung, Claim-Safety, Duplicate-Content-Risiko, SEO-Qualität, CTA-Logik, SSOT-Konformität.\n\nOUTPUT (JSON):\n{ "decision": "approved|revise|rejected", "overall_score": 0-100, "dimension_scores": {...}, "critical_issues": [...], "required_fixes": [...], "rationale": "..." }`;
}
function buildCriticUser(asset: Record<string, unknown>, ssot: Record<string, unknown>, proposal: unknown) {
  return `Prüfe diesen Content-Vorschlag:\nAsset: ${asset.asset_type} / ${asset.target_audience || asset.target_group}\nSlug: ${asset.slug}\nSSOT: ${JSON.stringify(ssot)}\n\nPROPOSAL:\n${JSON.stringify(proposal, null, 2)}`;
}

// ── Decision Matrix ──
function computeDecision(critique: Record<string, unknown>) {
  const vote = (critique.decision as string) || "revise";
  const score = (critique.overall_score as number) || 50;
  if (vote === "rejected") return { finalDecision: "rejected" as const, validatorVote: "rejected", consensusScore: 0.2, requiredFixes: critique.required_fixes || critique.critical_issues, rationale: critique.rationale };
  if (vote === "approved" && score >= 70) return { finalDecision: "approved" as const, validatorVote: "approved", consensusScore: score / 100, rationale: critique.rationale };
  return { finalDecision: "revise" as const, validatorVote: "revise", consensusScore: score / 100, requiredFixes: critique.required_fixes || critique.critical_issues, rationale: critique.rationale };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
