import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action || body._job_type || "run_asset";
    const assetId = body.assetId || body.asset_id;
    const round = body.round ?? 1;
    const maxRounds = body.maxRounds ?? 3;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    // ── SEED ASSETS ──
    if (action === "marketing_seed_assets") {
      const seeds = [
        { asset_type: "landing_page", slug: "pruefungstraining-azubis", title: "Prüfungstraining für Azubis", target_audience: "azubis", target_group: "azubis" },
        { asset_type: "landing_page", slug: "pruefungstraining-betriebe", title: "Prüfungstraining für Betriebe", target_audience: "betriebe", target_group: "betriebe" },
        { asset_type: "landing_page", slug: "pruefungstraining-institutionen", title: "Prüfungstraining für Institutionen", target_audience: "institutionen", target_group: "institutionen" },
      ];
      for (const s of seeds) {
        await sb.from("marketing_assets").upsert(
          { ...s, locale: "de-DE", status: "draft" },
          { onConflict: "asset_type,slug,locale", ignoreDuplicates: true }
        );
      }
      return json({ ok: true, seeded: seeds.length });
    }

    // ── PROPOSE (GPT-4.1) ──
    if (action === "marketing_propose" || action === "run_asset") {
      if (!assetId) throw new Error("assetId required");
      if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

      const { data: asset, error: aErr } = await sb
        .from("marketing_assets")
        .select("*")
        .eq("id", assetId)
        .single();
      if (aErr || !asset) throw new Error(`Asset not found: ${aErr?.message}`);

      // Build SSOT context
      const ssot = await buildSSOTContext(sb, asset);

      const systemPrompt = buildProposerSystem(asset);
      const userPrompt = buildProposerUser(asset, ssot);

      const proposal = await callOpenAI(OPENAI_API_KEY, systemPrompt, userPrompt);

      // Create content_version
      const { data: ver, error: vErr } = await sb
        .from("content_versions")
        .insert({
          course_id: asset.course_id ?? null,
          lesson_id: null,
          step_key: "marketing",
          entity_type: asset.asset_type,
          entity_id: asset.id,
          content_json: proposal,
          created_by_agent: "gpt-4.1",
          status: "under_review",
          council_round: round,
        })
        .select("id")
        .single();
      if (vErr) throw vErr;
      const versionId = ver!.id;

      await sb.from("council_messages").insert({
        content_version_id: versionId,
        agent_name: "gpt-4.1",
        message_type: "proposal",
        message_json: proposal,
      });

      // If full pipeline, continue to critique
      if (action === "run_asset") {
        return await runCritique(sb, ANTHROPIC_API_KEY, asset, ssot, proposal, versionId, round, maxRounds);
      }

      return json({ ok: true, versionId, phase: "proposed" });
    }

    // ── CRITIQUE (Claude Sonnet 4) ──
    if (action === "marketing_critique") {
      if (!assetId) throw new Error("assetId required");
      if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

      const versionId = body.versionId || body.version_id;
      if (!versionId) throw new Error("versionId required");

      const { data: asset } = await sb.from("marketing_assets").select("*").eq("id", assetId).single();
      if (!asset) throw new Error("Asset not found");

      const { data: ver } = await sb.from("content_versions").select("content_json").eq("id", versionId).single();
      if (!ver) throw new Error("Version not found");

      const ssot = await buildSSOTContext(sb, asset);
      return await runCritique(sb, ANTHROPIC_API_KEY, asset, ssot, ver.content_json, versionId, round, maxRounds);
    }

    // ── REVISE (GPT-4.1 with critique feedback) ──
    if (action === "marketing_revise") {
      if (!assetId || !OPENAI_API_KEY) throw new Error("assetId + OPENAI_API_KEY required");
      const versionId = body.versionId || body.version_id;

      const { data: asset } = await sb.from("marketing_assets").select("*").eq("id", assetId).single();
      if (!asset) throw new Error("Asset not found");

      // Get previous critique
      const { data: msgs } = await sb
        .from("council_messages")
        .select("message_json")
        .eq("content_version_id", versionId)
        .eq("message_type", "critique")
        .order("created_at", { ascending: false })
        .limit(1);

      const critique = msgs?.[0]?.message_json || {};
      const ssot = await buildSSOTContext(sb, asset);

      const revisedProposal = await callOpenAI(
        OPENAI_API_KEY,
        buildProposerSystem(asset),
        `Überarbeite basierend auf dieser Kritik:\n${JSON.stringify(critique)}\n\nSSOT:\n${JSON.stringify(ssot)}`
      );

      // New version for next round
      const { data: newVer } = await sb
        .from("content_versions")
        .insert({
          course_id: asset.course_id ?? null,
          lesson_id: null,
          step_key: "marketing",
          entity_type: asset.asset_type,
          entity_id: asset.id,
          content_json: revisedProposal,
          created_by_agent: "gpt-4.1",
          status: "under_review",
          council_round: round,
        })
        .select("id")
        .single();

      await sb.from("council_messages").insert({
        content_version_id: newVer!.id,
        agent_name: "gpt-4.1",
        message_type: "revision",
        message_json: revisedProposal,
      });

      return json({ ok: true, versionId: newVer!.id, phase: "revised", round });
    }

    // ── PUBLISH (only approved versions) ──
    if (action === "marketing_publish") {
      if (!assetId) throw new Error("assetId required");
      const versionId = body.versionId || body.version_id;
      if (!versionId) throw new Error("versionId required");

      const { error: pubErr } = await sb.rpc("publish_marketing_asset", {
        p_asset_id: assetId,
        p_version_id: versionId,
      });
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
async function runCritique(
  sb: ReturnType<typeof createClient>,
  anthropicKey: string | undefined,
  asset: Record<string, unknown>,
  ssot: Record<string, unknown>,
  proposal: unknown,
  versionId: string,
  round: number,
  maxRounds: number
) {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const critique = await callClaude(anthropicKey, buildCriticSystem(asset), buildCriticUser(asset, ssot, proposal));

  await sb.from("council_messages").insert({
    content_version_id: versionId,
    agent_name: "claude-sonnet-4",
    message_type: "critique",
    message_json: critique,
  });

  // Decision Matrix
  const decision = computeDecision(critique);

  await sb.from("council_votes").insert([
    { content_version_id: versionId, agent_name: "gpt-4.1", vote: decision.finalDecision === "rejected" ? "revise" : decision.finalDecision, confidence: 0.7, rationale: "proposer self-check" },
    { content_version_id: versionId, agent_name: "claude-sonnet-4", vote: decision.validatorVote, confidence: decision.consensusScore, rationale: decision.rationale || "validator assessment" },
  ]);

  await sb.from("council_verdicts").insert({
    content_version_id: versionId,
    final_decision: decision.finalDecision,
    consensus_score: decision.consensusScore,
    required_fixes: decision.requiredFixes,
    decided_by: "marketing_council",
  });

  if (decision.finalDecision === "approved") {
    await sb.from("content_versions").update({ status: "approved" }).eq("id", versionId);
    const { error: pubErr } = await sb.rpc("publish_marketing_asset", {
      p_asset_id: asset.id as string,
      p_version_id: versionId,
    });
    if (pubErr) console.error("Auto-publish failed:", pubErr.message);
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

// ── LLM Helpers ──
async function callOpenAI(apiKey: string, system: string, user: string): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); } catch { return { raw }; }
}

async function callClaude(apiKey: string, system: string, user: string): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text || "{}";
  try { const m = raw.match(/\{[\s\S]*\}/); return JSON.parse(m?.[0] || raw); } catch { return { raw }; }
}

// ── SSOT Context Builder ──
async function buildSSOTContext(sb: ReturnType<typeof createClient>, asset: Record<string, unknown>) {
  const ctx: Record<string, unknown> = {};
  if (asset.course_id) {
    const { data } = await sb.from("courses").select("title, description, slug, beruf_id").eq("id", asset.course_id).single();
    ctx.course = data;
  }
  if (asset.certification_id) {
    const { data } = await sb.from("curricula").select("title, beruf_id").eq("id", asset.certification_id).single();
    ctx.certification = data;
  }
  return ctx;
}

// ── Prompt Builders ──
function buildProposerSystem(asset: Record<string, unknown>) {
  return `Du bist der ExamFit Marketing Council Content-Autor (GPT-4.1).
Erzeuge ausschließlich SSOT-konformen Marketing-Content als JSON.

REGELN:
- NUR Fakten aus dem SSOT-Kontext verwenden
- KEINE falschen Versprechen ("garantiert bestehen" etc.)
- KEINE IHK-offiziell Claims
- Wording: "Prüfung starten" / "Prüfung simulieren" (nicht "Prüfung ablegen")
- Zielgruppen strikt trennen: Azubis ≠ Betriebe ≠ Institutionen
- Kein "Schüler" verwenden
- Sprache: Deutsch (de-DE)

OUTPUT FORMAT (JSON):
{
  "meta": { "title": "max 60 Zeichen", "description": "max 160 Zeichen", "canonical_slug": "..." },
  "hero": { "headline": "...", "subline": "...", "cta_text": "...", "cta_url": "..." },
  "sections": [{ "type": "features|testimonial|faq|cta", "heading": "...", "content": "..." }],
  "faq": [{ "q": "...", "a": "..." }],
  "structured_data": { "@type": "Product|FAQPage|Article", ... }
}`;
}

function buildProposerUser(asset: Record<string, unknown>, ssot: Record<string, unknown>) {
  return `Erstelle Content für: ${asset.asset_type}
Titel: ${asset.title}
Zielgruppe: ${asset.target_audience || asset.target_group || "allgemein"}
Slug: ${asset.slug || "tbd"}
SSOT-Kontext: ${JSON.stringify(ssot)}`;
}

function buildCriticSystem(asset: Record<string, unknown>) {
  return `Du bist der ExamFit Marketing Council Validator (Claude Sonnet 4).
Prüfe Marketing-Content auf:
1. Zielgruppen-Passung (azubi/betriebe/institutionen)
2. Claim-Safety (KEINE IHK-offiziell, KEINE Garantien)
3. Duplicate-Content-Risiko (canonical, unique value prop)
4. SEO-Qualität (meta title <60 chars, description <160)
5. CTA-Logik (klarer Nutzen, kein Clickbait)
6. SSOT-Konformität (nur belegbare Fakten)

OUTPUT (JSON):
{
  "decision": "approved|revise|rejected",
  "overall_score": 0-100,
  "dimension_scores": { "zielgruppe": 0-100, "claims": 0-100, "seo": 0-100, "duplicate_risk": 0-100, "cta": 0-100, "ssot": 0-100 },
  "critical_issues": ["..."],
  "required_fixes": ["..."],
  "rationale": "..."
}`;
}

function buildCriticUser(asset: Record<string, unknown>, ssot: Record<string, unknown>, proposal: unknown) {
  return `Prüfe diesen Content-Vorschlag:
Asset: ${asset.asset_type} / ${asset.target_audience || asset.target_group}
Slug: ${asset.slug}
SSOT: ${JSON.stringify(ssot)}

PROPOSAL:
${JSON.stringify(proposal, null, 2)}`;
}

// ── Decision Matrix ──
function computeDecision(critique: unknown) {
  const c = critique as Record<string, unknown> || {};
  const vote = (c.decision as string) || "revise";
  const score = (c.overall_score as number) || 50;

  // Hard veto: rejected is final
  if (vote === "rejected") {
    return { finalDecision: "rejected" as const, validatorVote: "rejected", consensusScore: 0.2, requiredFixes: c.required_fixes || c.critical_issues, rationale: c.rationale };
  }
  if (vote === "approved" && score >= 70) {
    return { finalDecision: "approved" as const, validatorVote: "approved", consensusScore: score / 100, rationale: c.rationale };
  }
  return { finalDecision: "revise" as const, validatorVote: "revise", consensusScore: score / 100, requiredFixes: c.required_fixes || c.critical_issues, rationale: c.rationale };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
