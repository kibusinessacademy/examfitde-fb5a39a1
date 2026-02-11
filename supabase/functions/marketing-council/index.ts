import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, month, campaign_id, asset_id } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── GENERATE MONTHLY STRATEGY (GPT-5.2 Deep Thinking) ──
    if (action === "generate_strategy") {
      const targetMonth = month || new Date().toISOString().slice(0, 7);

      const systemPrompt = `Du bist der Chief Growth Strategist im Marketing & Sales Council.
Deine Aufgabe: Erstelle einen datengetriebenen Monatsplan für eine EdTech-Plattform (IHK-Prüfungsvorbereitung).

REGELN:
- Budget: genau 100€
- Zielgruppen: azubi, unternehmen, berufsschule (jede Aktion braucht mindestens eine)
- Keine IHK-offiziell Claims
- Jede Hypothese muss messbar sein
- Plan → Test → Measure → Learn → Optimize → Scale

Antworte NUR mit validem JSON im folgenden Format:
{
  "month": "${targetMonth}",
  "budget_split": { "seo": 40, "paid": 40, "email": 20, "content": 0, "reserve": 0 },
  "priorities": ["...", "..."],
  "hypotheses": [
    { "hypothesis": "...", "metric": "...", "target": "...", "channel": "..." }
  ],
  "campaigns": [
    { "name": "...", "channel": "seo|paid_google|paid_meta|email|social|content", "target_groups": ["azubi"], "budget": 20, "hypothesis": "...", "kill_switch": { "max_days": 7, "min_ctr": 0.5 } }
  ]
}`;

      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Erstelle den Marketing-Plan für ${targetMonth}. Fokus auf organisches Wachstum und kosteneffiziente Paid-Tests.` }
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("GPT-5.2 error:", response.status, errText);
        throw new Error(`AI gateway error: ${response.status}`);
      }

      const aiResult = await response.json();
      const content = aiResult.choices?.[0]?.message?.content || "";

      let strategyJson;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        strategyJson = JSON.parse(jsonMatch?.[0] || content);
      } catch {
        strategyJson = { raw: content };
      }

      // Update the plan
      const { error: updateError } = await supabase
        .from("marketing_plans")
        .update({
          strategy_json: strategyJson,
          budget_split: strategyJson.budget_split || { seo: 40, paid: 40, email: 20, content: 0, reserve: 0 },
          hypotheses: strategyJson.hypotheses || [],
          priorities: strategyJson.priorities || [],
          status: "generated",
        })
        .eq("month", targetMonth);

      if (updateError) throw updateError;

      // Auto-create campaigns from plan
      if (strategyJson.campaigns) {
        for (const campaign of strategyJson.campaigns) {
          await supabase.from("marketing_campaigns").insert({
            plan_id: null, // will be linked later
            name: campaign.name,
            channel: campaign.channel,
            target_groups: campaign.target_groups || ["azubi"],
            hypothesis: campaign.hypothesis,
            budget_allocated: campaign.budget || 0,
            kill_switch_rules: campaign.kill_switch || { max_days_without_conversion: 7, min_ctr: 0.5 },
            status: "planned",
            validation_status: "pending",
          });
        }
      }

      // ── VALIDATE with Claude Opus 4.6 ──
      if (ANTHROPIC_API_KEY) {
        const validationPrompt = `Du bist der Validation & ROI Controller im Marketing Council.
Prüfe diesen Marketing-Plan auf:
1. Zielgruppen-Passung (azubi/unternehmen/berufsschule)
2. Rechtliche Risiken (KEINE IHK-offiziell Claims!)
3. Budget-Effizienz (100€ Monatsbudget)
4. Messbarkeit der Hypothesen
5. Realistische KPIs

Plan:
${JSON.stringify(strategyJson, null, 2)}

Antworte NUR mit JSON:
{
  "overall_score": 0-100,
  "decision": "approve|revise|reject",
  "dimension_scores": {
    "zielgruppen_fit": 0-100,
    "rechtssicherheit": 0-100,
    "budget_effizienz": 0-100,
    "messbarkeit": 0-100,
    "realismus": 0-100
  },
  "critical_issues": [],
  "suggestions": []
}`;

        const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2000,
            messages: [{ role: "user", content: validationPrompt }],
          }),
        });

        if (claudeResponse.ok) {
          const claudeResult = await claudeResponse.json();
          const validationText = claudeResult.content?.[0]?.text || "";
          let validationReport;
          try {
            const jsonMatch = validationText.match(/\{[\s\S]*\}/);
            validationReport = JSON.parse(jsonMatch?.[0] || validationText);
          } catch {
            validationReport = { overall_score: 0, decision: "revise", raw: validationText };
          }

          const newStatus = validationReport.decision === "approve" ? "validated" :
                            validationReport.decision === "reject" ? "draft" : "generated";

          await supabase
            .from("marketing_plans")
            .update({
              validation_score: validationReport.overall_score,
              validation_report: validationReport,
              validated_at: new Date().toISOString(),
              status: newStatus,
            })
            .eq("month", targetMonth);
        }
      }

      return new Response(JSON.stringify({ success: true, strategy: strategyJson }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── VALIDATE ASSET (Claude Opus 4.6) ──
    if (action === "validate_asset" && asset_id) {
      if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

      const { data: asset } = await supabase
        .from("marketing_assets")
        .select("*")
        .eq("id", asset_id)
        .single();

      if (!asset) throw new Error("Asset not found");

      const validationPrompt = `Du bist der Validation & ROI Controller.
Prüfe diesen Marketing-Content:

Typ: ${asset.asset_type}
Zielgruppe: ${asset.target_group}
Titel: ${asset.title}
Content: ${asset.content}

Prüfkriterien:
1. Zielgruppen-Passung
2. Rechtlich (KEINE IHK-offiziell Claims, keine Logos, klare Distanzierung)
3. SEO-Qualität
4. Conversion-Logik
5. Sprachqualität

JSON-Antwort:
{
  "overall_score": 0-100,
  "decision": "approve|revise|reject",
  "legal_check_passed": true|false,
  "seo_score": 0-100,
  "issues": [],
  "suggestions": []
}`;

      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [{ role: "user", content: validationPrompt }],
        }),
      });

      if (!claudeResponse.ok) throw new Error("Claude validation failed");

      const claudeResult = await claudeResponse.json();
      const validationText = claudeResult.content?.[0]?.text || "";
      let report;
      try {
        const jsonMatch = validationText.match(/\{[\s\S]*\}/);
        report = JSON.parse(jsonMatch?.[0] || validationText);
      } catch {
        report = { overall_score: 0, decision: "revise" };
      }

      const newStatus = report.decision === "approve" ? "validated" :
                        report.decision === "reject" ? "rejected" : "draft";

      await supabase
        .from("marketing_assets")
        .update({
          validation_score: report.overall_score,
          validation_report: report,
          legal_check_passed: report.legal_check_passed ?? false,
          seo_score: report.seo_score ?? null,
          status: newStatus,
        })
        .eq("id", asset_id);

      return new Response(JSON.stringify({ success: true, report }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("marketing-council error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
