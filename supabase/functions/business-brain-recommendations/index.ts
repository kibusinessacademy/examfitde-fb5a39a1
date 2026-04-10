import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonH = { ...corsHeaders, "Content-Type": "application/json" };

  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "enrich";

    if (action === "enrich") {
      // Get proposed recommendations without AI enrichment
      const { data: recs } = await admin
        .from("business_brain_recommendations")
        .select("*")
        .eq("status", "proposed")
        .is("ai_summary", null)
        .order("priority_score", { ascending: false })
        .limit(10);

      if (!recs || recs.length === 0) {
        return new Response(JSON.stringify({ success: true, enriched: 0 }), { headers: jsonH });
      }

      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      let enriched = 0;

      if (LOVABLE_API_KEY) {
        for (const rec of recs) {
          try {
            const prompt = `Du bist ein Business Intelligence Analyst für ExamFit, eine Prüfungstrainings-Plattform.

Analysiere diese Empfehlung und gib eine strukturierte Einschätzung:

Typ: ${rec.recommendation_type}
Titel: ${rec.title}
Zusammenfassung: ${rec.summary}
Priorität: ${rec.priority_score}
Kontext: ${JSON.stringify(rec.rationale)}
Empfohlene Aktion: ${JSON.stringify(rec.recommended_action)}

Antworte auf Deutsch mit exakt diesem Format:
ZUSAMMENFASSUNG: [1-2 Sätze strategische Einordnung]
BEGRÜNDUNG: [2-3 Sätze warum diese Empfehlung wichtig ist]
RISIKEN: [1-2 Sätze zu möglichen Risiken bei Umsetzung oder Nicht-Umsetzung]
ERWARTETER IMPACT: [1-2 Sätze zum erwarteten Effekt]`;

            const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: "Du bist ein strategischer Business-Analyst. Antworte präzise und datengetrieben." },
                  { role: "user", content: prompt },
                ],
              }),
            });

            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const text = aiData.choices?.[0]?.message?.content || "";

              const extractSection = (label: string) => {
                const regex = new RegExp(`${label}:\\s*(.+?)(?=\\n[A-ZÄÖÜ]+:|$)`, "s");
                return regex.exec(text)?.[1]?.trim() || "";
              };

              await admin.from("business_brain_recommendations").update({
                ai_summary: extractSection("ZUSAMMENFASSUNG"),
                ai_rationale: extractSection("BEGRÜNDUNG"),
                ai_risk_notes: extractSection("RISIKEN"),
                ai_expected_impact: extractSection("ERWARTETER IMPACT"),
                updated_at: new Date().toISOString(),
              }).eq("id", rec.id);

              enriched++;
            } else if (aiRes.status === 429 || aiRes.status === 402) {
              console.warn(`[business-brain-recommendations] AI rate limited (${aiRes.status}), stopping enrichment`);
              break;
            }
          } catch (aiErr) {
            console.error(`[business-brain-recommendations] AI enrichment failed for ${rec.id}:`, aiErr);
          }
        }
      }

      return new Response(JSON.stringify({ success: true, enriched, total: recs.length }), { headers: jsonH });
    }

    if (action === "decide") {
      const { recommendation_id, decision, reason } = body;
      if (!recommendation_id || !decision) {
        return new Response(JSON.stringify({ error: "recommendation_id + decision required" }), { status: 400, headers: jsonH });
      }

      // Update recommendation status
      await admin.from("business_brain_recommendations").update({
        status: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision,
        updated_at: new Date().toISOString(),
      }).eq("id", recommendation_id);

      // Create decision record
      const { data: rec } = await admin
        .from("business_brain_recommendations")
        .select("*")
        .eq("id", recommendation_id)
        .single();

      if (rec) {
        await admin.from("business_brain_decisions").insert({
          recommendation_id,
          decision_type: rec.recommendation_type,
          decision_payload: rec.recommended_action || {},
          decided_by: "admin",
          outcome_status: decision === "approve" ? "pending" : "cancelled",
          outcome_notes: reason || null,
        });

        // If approved and auto_allowed, create action queue entry
        if (decision === "approve" && rec.execution_mode === "auto_allowed") {
          await admin.from("business_brain_action_queue").insert({
            action_type: (rec.recommended_action as Record<string, unknown>)?.action as string || rec.recommendation_type,
            action_payload: rec.recommended_action || {},
            source_recommendation_id: recommendation_id,
            status: "queued",
            execution_mode: "auto_allowed",
          });
        } else if (decision === "approve") {
          await admin.from("business_brain_action_queue").insert({
            action_type: (rec.recommended_action as Record<string, unknown>)?.action as string || rec.recommendation_type,
            action_payload: rec.recommended_action || {},
            source_recommendation_id: recommendation_id,
            status: "approved",
            execution_mode: "manual_review",
          });
        }
      }

      return new Response(JSON.stringify({ success: true }), { headers: jsonH });
    }

    if (action === "list") {
      const status = body.status || "proposed";
      const type = body.recommendation_type;
      let query = admin
        .from("business_brain_recommendations")
        .select("*")
        .order("priority_score", { ascending: false })
        .limit(50);

      if (status !== "all") query = query.eq("status", status);
      if (type) query = query.eq("recommendation_type", type);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      return new Response(JSON.stringify({ success: true, recommendations: data || [] }), { headers: jsonH });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: jsonH });
  } catch (e) {
    console.error("[business-brain-recommendations]", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: jsonH });
  }
});
