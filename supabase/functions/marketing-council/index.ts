// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, month, campaign_id, asset_id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ── GENERATE MONTHLY STRATEGY ──
    if (action === "generate_strategy") {
      const targetMonth = month || new Date().toISOString().slice(0, 7);

      const systemPrompt = `Du bist der Chief Growth Strategist im Marketing & Sales Council.
Deine Aufgabe: Erstelle einen datengetriebenen Monatsplan für eine EdTech-Plattform (IHK-Prüfungsvorbereitung).

REGELN:
- Budget: genau 100€
- Zielgruppen: azubi, unternehmen, berufsschule (jede Aktion braucht mindestens eine)
- Keine IHK-offiziell Claims
- Jede Hypothese muss messbar sein

Antworte NUR mit validem JSON:
{
  "month": "${targetMonth}",
  "budget_split": { "seo": 40, "paid": 40, "email": 20, "content": 0, "reserve": 0 },
  "priorities": ["...", "..."],
  "hypotheses": [{ "hypothesis": "...", "metric": "...", "target": "...", "channel": "..." }],
  "campaigns": [{ "name": "...", "channel": "seo|paid_google|paid_meta|email|social|content", "target_groups": ["azubi"], "budget": 20, "hypothesis": "...", "kill_switch": { "max_days": 7, "min_ctr": 0.5 } }]
}`;

      const chain = await getModelChainAsync("seo_content");
      const result = await callAIWithFailover(
        chain.map(c => ({ provider: c.provider, model: c.model })),
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Erstelle den Marketing-Plan für ${targetMonth}. Fokus auf organisches Wachstum und kosteneffiziente Paid-Tests.` },
          ],
        },
      );

      let strategyJson;
      try {
        const jsonMatch = result.content.match(/\{[\s\S]*\}/);
        strategyJson = JSON.parse(jsonMatch?.[0] || result.content);
      } catch { strategyJson = { raw: result.content }; }

      await supabase.from("marketing_plans").update({
        strategy_json: strategyJson,
        budget_split: strategyJson.budget_split || { seo: 40, paid: 40, email: 20, content: 0, reserve: 0 },
        hypotheses: strategyJson.hypotheses || [],
        priorities: strategyJson.priorities || [],
        status: "generated",
      }).eq("month", targetMonth);

      if (strategyJson.campaigns) {
        for (const campaign of strategyJson.campaigns) {
          await supabase.from("marketing_campaigns").insert({
            plan_id: null, name: campaign.name, channel: campaign.channel,
            target_groups: campaign.target_groups || ["azubi"], hypothesis: campaign.hypothesis,
            budget_allocated: campaign.budget || 0,
            kill_switch_rules: campaign.kill_switch || { max_days_without_conversion: 7, min_ctr: 0.5 },
            status: "planned", validation_status: "pending",
          });
        }
      }

      // ── VALIDATE with Council Review model ──
      try {
        const valChain = await getModelChainAsync("council_review");
        const valResult = await callAIWithFailover(
          valChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [{
              role: "user",
              content: `Du bist der Validation & ROI Controller im Marketing Council.
Prüfe diesen Marketing-Plan auf:
1. Zielgruppen-Passung
2. Rechtliche Risiken (KEINE IHK-offiziell Claims!)
3. Budget-Effizienz (100€ Monatsbudget)
4. Messbarkeit der Hypothesen
5. Realistische KPIs

Plan:
${JSON.stringify(strategyJson, null, 2)}

Antworte NUR mit JSON:
{"overall_score": 0-100, "decision": "approve|revise|reject", "dimension_scores": {}, "critical_issues": [], "suggestions": []}`
            }],
            max_tokens: 2000,
          },
        );

        let validationReport;
        try {
          const jsonMatch = valResult.content.match(/\{[\s\S]*\}/);
          validationReport = JSON.parse(jsonMatch?.[0] || valResult.content);
        } catch { validationReport = { overall_score: 0, decision: "revise", raw: valResult.content }; }

        const newStatus = validationReport.decision === "approve" ? "validated" :
                          validationReport.decision === "reject" ? "draft" : "generated";

        await supabase.from("marketing_plans").update({
          validation_score: validationReport.overall_score,
          validation_report: validationReport,
          validated_at: new Date().toISOString(),
          status: newStatus,
        }).eq("month", targetMonth);
      } catch (valErr) {
        console.warn("Validation failed (non-blocking):", valErr);
      }

      return new Response(JSON.stringify({ success: true, strategy: strategyJson }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── VALIDATE ASSET ──
    if (action === "validate_asset" && asset_id) {
      const { data: asset } = await supabase.from("marketing_assets").select("*").eq("id", asset_id).single();
      if (!asset) throw new Error("Asset not found");

      const validationRouted = getModel("council_review");
      const valResult = await callAIJSON({
        provider: validationRouted.provider,
        model: validationRouted.model,
        messages: [{
          role: "user",
          content: `Du bist der Validation & ROI Controller.
Prüfe diesen Marketing-Content:
Typ: ${asset.asset_type}, Zielgruppe: ${asset.target_group}, Titel: ${asset.title}, Content: ${asset.content}
Prüfkriterien: 1. Zielgruppen-Passung 2. Rechtlich (KEINE IHK-offiziell Claims) 3. SEO-Qualität 4. Conversion-Logik 5. Sprachqualität
JSON-Antwort: {"overall_score": 0-100, "decision": "approve|revise|reject", "legal_check_passed": true|false, "seo_score": 0-100, "issues": [], "suggestions": []}`
        }],
        max_tokens: 1500,
      });

      let report;
      try {
        const jsonMatch = valResult.content.match(/\{[\s\S]*\}/);
        report = JSON.parse(jsonMatch?.[0] || valResult.content);
      } catch { report = { overall_score: 0, decision: "revise" }; }

      const newStatus = report.decision === "approve" ? "validated" : report.decision === "reject" ? "rejected" : "draft";
      await supabase.from("marketing_assets").update({
        validation_score: report.overall_score, validation_report: report,
        legal_check_passed: report.legal_check_passed ?? false, seo_score: report.seo_score ?? null, status: newStatus,
      }).eq("id", asset_id);

      return new Response(JSON.stringify({ success: true, report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("marketing-council error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
