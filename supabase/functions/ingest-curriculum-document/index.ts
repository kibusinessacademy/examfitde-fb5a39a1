// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";

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
              "subtopics": [{ "subtopic_code": "string", "subtopic_name": "string" }],
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
- weight_hint nur wenn im Dokument explizit angegeben
- Keine Erfindungen, nur was im Dokument steht`;

async function firecrawlScrape(url: string, maxRetries = 3): Promise<string> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");

  let lastError = "";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 5000 }),
      });
      if (!res.ok) { lastError = `Firecrawl [${res.status}]`; if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
      const data = await res.json();
      const md = data?.data?.markdown || data?.markdown || "";
      if (md.length < 200) { lastError = `Only ${md.length} chars`; if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
      return md;
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000 * attempt)); }
  }
  throw new Error(`Firecrawl failed after ${maxRetries} retries: ${lastError}`);
}

async function extractTopicsLLM(text: string, docType: string) {
  const truncated = text.length > 80000 ? text.substring(0, 80000) : text;
  const routed = getModel("curriculum_import");
  const result = await callAIJSON({
    provider: routed.provider,
    model: routed.model,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: `Analysiere dieses Dokument (${docType}):\n\n${truncated}` },
    ],
    temperature: 0.1,
    max_tokens: 8000,
  });

  const cleaned = result.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return { extracted: JSON.parse(cleaned), usage: result.usage };
}

async function persistTopics(sb: ReturnType<typeof createClient>, certId: string, documentId: string, extracted: any) {
  let topicCount = 0;
  for (const part of (extracted.exam_parts || [])) {
    for (const domain of (part.domains || [])) {
      for (const topic of (domain.topics || [])) {
        const topicCode = topic.topic_code || `auto_${certId.slice(0,8)}_${topicCount}`;
        const { data: existing } = await sb.from("curriculum_topics").select("id").eq("certification_id", certId).eq("topic_code", topicCode).maybeSingle();

        let parentId: string;
        if (existing?.id) {
          await sb.from("curriculum_topics").update({ topic_name: topic.topic_name.trim(), description: topic.description || null, source_document_id: documentId, weight_percentage: topic.weight_hint || null, sort_order: topicCount }).eq("id", existing.id);
          parentId = existing.id;
        } else {
          const { data: newRow } = await sb.from("curriculum_topics").insert({ certification_id: certId, topic_name: topic.topic_name.trim(), topic_code: topicCode, description: topic.description || null, source_document_id: documentId, weight_percentage: topic.weight_hint || null, sort_order: topicCount }).select("id").single();
          parentId = newRow?.id;
        }
        topicCount++;

        for (const sub of (topic.subtopics || [])) {
          const subCode = sub.subtopic_code || `${topicCode}_sub${topicCount}`;
          const { data: existingSub } = await sb.from("curriculum_topics").select("id").eq("certification_id", certId).eq("topic_code", subCode).maybeSingle();
          if (existingSub?.id) {
            await sb.from("curriculum_topics").update({ topic_name: sub.subtopic_name.trim(), parent_topic_id: parentId, source_document_id: documentId, sort_order: topicCount }).eq("id", existingSub.id);
          } else {
            await sb.from("curriculum_topics").insert({ certification_id: certId, topic_name: sub.subtopic_name.trim(), topic_code: subCode, parent_topic_id: parentId, source_document_id: documentId, sort_order: topicCount });
          }
          topicCount++;
        }

        if (parentId) {
          await sb.from("curriculum_topic_coverage").upsert({ certification_id: certId, topic_id: parentId, blueprint_domain_key: domain.domain_key, coverage_weight: 1.0, mapped: false }, { onConflict: "certification_id,topic_id" });
        }
      }
    }
  }
  return topicCount;
}

async function updateRun(sb: ReturnType<typeof createClient>, runId: string, fields: Record<string, unknown>) {
  await sb.from("curriculum_ingest_runs").update(fields).eq("id", runId);
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) return auth.error === "Admin access required" ? forbiddenResponse(auth.error) : unauthorizedResponse(auth.error);

  try {
    const { document_id, run_id } = await req.json();
    if (!document_id) return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: doc, error: docErr } = await sb.from("certification_documents").select("*").eq("id", document_id).single();
    if (docErr || !doc) {
      if (run_id) await updateRun(sb, run_id, { status: "failed", error: "Document not found", finished_at: new Date().toISOString() });
      return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const actualRunId = run_id || (await sb.from("curriculum_ingest_runs").insert({ certification_id: doc.certification_id, document_id, run_type: "ingest", status: "running", started_at: new Date().toISOString() }).select("id").single()).data?.id;
    if (run_id) await updateRun(sb, run_id, { status: "running", started_at: new Date().toISOString() });

    await updateRun(sb, actualRunId, { status: "extracting" });
    let textContent = "", extractionMethod = "unknown";

    if (doc.source_url) {
      try { textContent = await firecrawlScrape(doc.source_url); extractionMethod = "firecrawl"; } catch {
        try { const resp = await fetch(doc.source_url); textContent = (await resp.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); extractionMethod = "direct_fetch"; } catch {
          await updateRun(sb, actualRunId, { status: "failed", error: "Extraction failed", finished_at: new Date().toISOString() });
          return new Response(JSON.stringify({ error: "Content extraction failed" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    } else if (doc.storage_path) {
      const { data: signedData } = await sb.storage.from("curriculum-docs").createSignedUrl(doc.storage_path, 600);
      if (signedData?.signedUrl) {
        try { textContent = await firecrawlScrape(signedData.signedUrl); extractionMethod = "firecrawl_pdf"; } catch {
          const { data: fileData } = await sb.storage.from("curriculum-docs").download(doc.storage_path);
          if (fileData) { textContent = await fileData.text(); extractionMethod = "storage_direct"; }
        }
      }
    }

    if (!textContent || textContent.length < 50) {
      await updateRun(sb, actualRunId, { status: "failed", error: "No content extracted", finished_at: new Date().toISOString() });
      return new Response(JSON.stringify({ error: "No content" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await updateRun(sb, actualRunId, { status: "llm_extract" });
    const { extracted, usage } = await extractTopicsLLM(textContent, doc.doc_type);

    await updateRun(sb, actualRunId, { status: "persisting" });
    const topicCount = await persistTopics(sb, doc.certification_id, document_id, extracted);

    await updateRun(sb, actualRunId, { status: "mapping" });
    try { await sb.functions.invoke("auto-map-topics-to-blueprint", { body: { certification_id: doc.certification_id } }); } catch (mapErr) { console.warn("Auto-map failed (non-blocking):", mapErr); }

    await updateRun(sb, actualRunId, { status: "computing_coverage" });
    const { data: coverageResult } = await sb.rpc("compute_curriculum_coverage", { p_certification_id: doc.certification_id });
    await sb.rpc("set_curriculum_hold_if_needed", { p_certification_id: doc.certification_id });

    await updateRun(sb, actualRunId, { status: "success", finished_at: new Date().toISOString(), metrics: { extracted_topics_count: topicCount, extraction_method: extractionMethod, content_length: textContent.length, input_tokens: usage?.input_tokens, output_tokens: usage?.output_tokens, coverage: coverageResult } });

    return new Response(JSON.stringify({ success: true, run_id: actualRunId, topics_extracted: topicCount, extraction_method: extractionMethod, coverage: coverageResult }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Ingest error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
