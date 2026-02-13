import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EXTRACTION_PROMPT = `Du bist ein Experte für die Analyse deutscher IHK-Prüfungsordnungen und Rahmenlehrpläne.

Extrahiere ALLE Themen und Unterthemen aus dem Dokument. Strukturiere sie hierarchisch.

Antworte AUSSCHLIESSLICH mit validem JSON:
{
  "certification_name": "string",
  "exam_parts": [
    {
      "part_key": "TEIL_1" | "TEIL_2",
      "part_name": "string",
      "domains": [
        {
          "domain_key": "string (snake_case, stabil)",
          "domain_name": "string",
          "weight_hint": number | null,
          "topics": [
            {
              "topic_code": "string (z.B. T1.D1.01)",
              "topic_name": "string",
              "description": "string (kurz)",
              "subtopics": [
                {
                  "subtopic_code": "string",
                  "subtopic_name": "string"
                }
              ],
              "weight_hint": number | null
            }
          ]
        }
      ]
    }
  ]
}

Regeln:
- Extrahiere JEDEN genannten Inhaltspunkt, nicht nur Überschriften
- topic_code muss stabil und eindeutig sein
- Subtopics sind die feinste Ebene
- weight_hint nur wenn im Dokument explizit angegeben
- Keine Erfindungen, nur was im Dokument steht`;

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error)
      : unauthorizedResponse(auth.error);
  }

  try {
    const { document_id, run_id } = await req.json();
    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Mark run as running
    const actualRunId = run_id || (await sb.from("curriculum_ingest_runs")
      .insert({ certification_id: "00000000-0000-0000-0000-000000000000", document_id, run_type: "ingest", status: "running", started_at: new Date().toISOString() })
      .select("id").single()).data?.id;

    if (run_id) {
      await sb.from("curriculum_ingest_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", run_id);
    }

    // Load document
    const { data: doc, error: docErr } = await sb.from("certification_documents").select("*").eq("id", document_id).single();
    if (docErr || !doc) {
      await sb.from("curriculum_ingest_runs").update({ status: "failed", error: "Document not found", finished_at: new Date().toISOString() }).eq("id", actualRunId);
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch content
    let textContent = "";
    if (doc.source_kind === "url" && doc.source_url) {
      const resp = await fetch(doc.source_url);
      textContent = await resp.text();
      // Strip HTML tags for cleaner extraction
      textContent = textContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (textContent.length > 80000) textContent = textContent.substring(0, 80000);
    } else if (doc.source_kind === "pdf_upload" && doc.storage_path) {
      const { data: fileData } = await sb.storage.from("curriculum-docs").download(doc.storage_path);
      if (fileData) {
        textContent = await fileData.text();
        if (textContent.length > 80000) textContent = textContent.substring(0, 80000);
      }
    }

    if (!textContent || textContent.length < 50) {
      await sb.from("curriculum_ingest_runs").update({ status: "failed", error: "No content extracted from document", finished_at: new Date().toISOString() }).eq("id", actualRunId);
      return new Response(JSON.stringify({ error: "No content in document" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI Extraction
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Analysiere dieses Dokument (${doc.doc_type}):\n\n${textContent}` },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      await sb.from("curriculum_ingest_runs").update({ status: "failed", error: `AI error: ${aiResp.status}`, finished_at: new Date().toISOString() }).eq("id", actualRunId);
      throw new Error(`AI error ${aiResp.status}: ${errText}`);
    }

    const aiData = await aiResp.json();
    const raw = aiData.choices?.[0]?.message?.content || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const extracted = JSON.parse(cleaned);

    // Persist topics
    let topicCount = 0;
    const certId = doc.certification_id;

    for (const part of (extracted.exam_parts || [])) {
      for (const domain of (part.domains || [])) {
        for (const topic of (domain.topics || [])) {
          // Insert parent topic
          const { data: parentRow } = await sb.from("curriculum_topics").upsert({
            certification_id: certId,
            topic_name: topic.topic_name,
            topic_code: topic.topic_code,
            description: topic.description,
            source_document_id: document_id,
            weight_percentage: topic.weight_hint,
            sort_order: topicCount,
          }, { onConflict: "id" }).select("id").single();

          topicCount++;

          // Insert subtopics
          for (const sub of (topic.subtopics || [])) {
            await sb.from("curriculum_topics").upsert({
              certification_id: certId,
              topic_name: sub.subtopic_name,
              topic_code: sub.subtopic_code,
              parent_topic_id: parentRow?.id,
              source_document_id: document_id,
              sort_order: topicCount,
            }, { onConflict: "id" }).select("id").single();
            topicCount++;
          }

          // Create coverage entry (unmapped)
          if (parentRow?.id) {
            await sb.from("curriculum_topic_coverage").upsert({
              certification_id: certId,
              topic_id: parentRow.id,
              blueprint_domain_key: domain.domain_key,
              coverage_weight: 1.0,
              mapped: false,
            }, { onConflict: "certification_id,topic_id" });
          }
        }
      }
    }

    // Compute coverage
    const { data: coverageResult } = await sb.rpc("compute_curriculum_coverage", { p_certification_id: certId });

    // Update run
    await sb.from("curriculum_ingest_runs").update({
      status: "success",
      finished_at: new Date().toISOString(),
      metrics: {
        extracted_topics_count: topicCount,
        input_tokens: aiData.usage?.prompt_tokens,
        output_tokens: aiData.usage?.completion_tokens,
        coverage: coverageResult,
      },
    }).eq("id", actualRunId);

    // Set hold if needed
    await sb.rpc("set_curriculum_hold_if_needed", { p_certification_id: certId });

    return new Response(JSON.stringify({
      success: true,
      run_id: actualRunId,
      topics_extracted: topicCount,
      coverage: coverageResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Ingest error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
