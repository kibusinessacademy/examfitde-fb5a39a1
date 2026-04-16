// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-curriculum-ingest — Pipeline step that automatically extracts
 * deep curriculum topics from certification documents (PDFs/URLs).
 *
 * Called by job-runner when curriculum_ingest step is queued.
 * Discovers documents, extracts via LLM, persists to curriculum_topics.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EXTRACTION_PROMPT = `Du bist ein Experte für die Analyse deutscher IHK-Prüfungsordnungen, Rahmenlehrpläne und Fortbildungsverordnungen.

Extrahiere ALLE Themen und Unterthemen aus dem Dokument. Strukturiere sie hierarchisch.
Verwende die EXAKTEN offiziellen Bezeichnungen aus dem Dokument – keine Abkürzungen oder Umformulierungen.

Antworte AUSSCHLIESSLICH mit validem JSON:
{
  "certification_name": "string",
  "certification_type": "ausbildung" | "fortbildung" | "aevo" | "sachkunde",
  "structure_type": "lernfelder" | "qualifikationsbereiche" | "handlungsfelder",
  "exam_parts": [
    {
      "part_key": "string (z.B. WQ, HQ, TEIL_1, HF)",
      "part_name": "string (offizieller Name)",
      "domains": [
        {
          "domain_key": "string (snake_case, stabil, z.B. rechnungswesen)",
          "domain_name": "string (exakter offizieller Name)",
          "weight_hint": number | null,
          "topics": [
            {
              "topic_code": "string (z.B. WQ.1.01 oder LF01.T01)",
              "topic_name": "string (exakter offizieller Name)",
              "description": "string (kurz, aus dem Dokument)",
              "subtopics": [
                { 
                  "subtopic_code": "string", 
                  "subtopic_name": "string (exakter offizieller Name)" 
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
- Verwende die EXAKTEN Formulierungen aus dem Dokument
- topic_code muss stabil und eindeutig sein
- Für Fortbildungen (Fachwirt/Meister): Qualifikationsbereiche → Themen → Unterthemen
- Für Ausbildungen: Lernfelder → Themencluster → Einzelthemen
- Für AEVO: Handlungsfelder → Kompetenzbereiche → Themen
- weight_hint nur wenn im Dokument explizit angegeben
- Keine Erfindungen, nur was im Dokument steht
- DUPLIKATE zwischen WQ und HQ sind erlaubt und gewollt (gleicher Name, verschiedene Tiefe)`;

async function extractTextFromStorage(
  sb: ReturnType<typeof createClient>,
  storagePath: string,
): Promise<{ text: string; method: string }> {
  // Try Firecrawl first for PDFs
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  
  // Get signed URL for storage access
  const { data: signedData } = await sb.storage
    .from("curriculum-docs")
    .createSignedUrl(storagePath, 600);

  if (signedData?.signedUrl && apiKey) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: signedData.signedUrl, formats: ["markdown"], onlyMainContent: true, waitFor: 5000 }),
      });
      if (res.ok) {
        const data = await res.json();
        const md = data?.data?.markdown || data?.markdown || "";
        if (md.length > 200) return { text: md, method: "firecrawl_pdf" };
      }
    } catch (e) {
      console.warn("Firecrawl failed, falling back to direct download:", e);
    }
  }

  // Fallback: direct download
  const { data: fileData } = await sb.storage.from("curriculum-docs").download(storagePath);
  if (fileData) {
    const text = await fileData.text();
    if (text.length > 100) return { text, method: "storage_direct" };
  }

  throw new Error(`Could not extract text from storage: ${storagePath}`);
}

async function extractTextFromUrl(url: string): Promise<{ text: string; method: string }> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  
  if (apiKey) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 5000 }),
      });
      if (res.ok) {
        const data = await res.json();
        const md = data?.data?.markdown || data?.markdown || "";
        if (md.length > 200) return { text: md, method: "firecrawl_url" };
      }
    } catch (e) {
      console.warn("Firecrawl URL failed:", e);
    }
  }

  // Direct fetch fallback
  const resp = await fetch(url);
  const text = (await resp.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > 100) return { text, method: "direct_fetch" };
  
  throw new Error(`Could not extract text from URL: ${url}`);
}

async function persistTopics(
  sb: ReturnType<typeof createClient>,
  certId: string,
  extracted: any,
) {
  let topicCount = 0;

  for (const part of (extracted.exam_parts || [])) {
    for (const domain of (part.domains || [])) {
      for (const topic of (domain.topics || [])) {
        const topicCode = topic.topic_code || `auto_${certId.slice(0, 8)}_${topicCount}`;
        
        const { data: existing } = await sb
          .from("curriculum_topics")
          .select("id")
          .eq("certification_id", certId)
          .eq("topic_code", topicCode)
          .maybeSingle();

        let parentId: string;
        if (existing?.id) {
          await sb.from("curriculum_topics").update({
            topic_name: topic.topic_name.trim(),
            description: topic.description || null,
            weight_percentage: topic.weight_hint || null,
            sort_order: topicCount,
          }).eq("id", existing.id);
          parentId = existing.id;
        } else {
          const { data: newRow } = await sb.from("curriculum_topics").insert({
            certification_id: certId,
            topic_name: topic.topic_name.trim(),
            topic_code: topicCode,
            description: topic.description || null,
            weight_percentage: topic.weight_hint || null,
            sort_order: topicCount,
          }).select("id").single();
          parentId = newRow?.id;
        }
        topicCount++;

        // Insert subtopics
        for (const sub of (topic.subtopics || [])) {
          const subCode = sub.subtopic_code || `${topicCode}_sub${topicCount}`;
          const { data: existingSub } = await sb
            .from("curriculum_topics")
            .select("id")
            .eq("certification_id", certId)
            .eq("topic_code", subCode)
            .maybeSingle();

          if (existingSub?.id) {
            await sb.from("curriculum_topics").update({
              topic_name: sub.subtopic_name.trim(),
              parent_topic_id: parentId,
              sort_order: topicCount,
            }).eq("id", existingSub.id);
          } else {
            await sb.from("curriculum_topics").insert({
              certification_id: certId,
              topic_name: sub.subtopic_name.trim(),
              topic_code: subCode,
              parent_topic_id: parentId,
              sort_order: topicCount,
            });
          }
          topicCount++;
        }

        // Coverage mapping
        if (parentId) {
          await sb.from("curriculum_topic_coverage").upsert({
            certification_id: certId,
            topic_id: parentId,
            blueprint_domain_key: domain.domain_key,
            coverage_weight: 1.0,
            mapped: false,
          }, { onConflict: "certification_id,topic_id" });
        }
      }
    }
  }

  return topicCount;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { package_id, document_id, certification_id, step_id } = await req.json();
    
    if (!package_id || !certification_id) {
      return new Response(
        JSON.stringify({ error: "package_id and certification_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── 1. Find all active documents for this certification ──
    const { data: docs } = await sb
      .from("certification_documents")
      .select("*")
      .eq("certification_id", certification_id)
      .eq("status", "active")
      .order("legal_priority", { ascending: false });

    if (!docs || docs.length === 0) {
      // Mark step as skipped
      if (step_id) {
        await sb.from("package_steps").update({
          status: "skipped",
          last_error: "No active documents found",
          finished_at: new Date().toISOString(),
        }).eq("id", step_id);
      }
      return new Response(
        JSON.stringify({ error: "No documents found", skipped: true }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[package-curriculum-ingest] Processing ${docs.length} documents for cert ${certification_id}`);

    let totalTopics = 0;
    const results: any[] = [];

    // ── 2. Process each document ──
    for (const doc of docs) {
      try {
        // Extract text
        let textContent = "";
        let method = "unknown";

        if (doc.storage_path) {
          const result = await extractTextFromStorage(sb, doc.storage_path);
          textContent = result.text;
          method = result.method;
        } else if (doc.source_url) {
          const result = await extractTextFromUrl(doc.source_url);
          textContent = result.text;
          method = result.method;
        } else {
          console.warn(`[package-curriculum-ingest] Doc ${doc.id} has no storage_path or source_url`);
          continue;
        }

        if (textContent.length < 50) {
          console.warn(`[package-curriculum-ingest] Doc ${doc.id}: too short (${textContent.length} chars)`);
          continue;
        }

        // Truncate for LLM
        const truncated = textContent.length > 80000 ? textContent.substring(0, 80000) : textContent;

        // ── 3. LLM extraction ──
        const routed = getModel("curriculum_import");
        const llmResult = await callAIJSON({
          provider: routed.provider,
          model: routed.model,
          messages: [
            { role: "system", content: EXTRACTION_PROMPT },
            { role: "user", content: `Analysiere dieses Dokument (${doc.doc_type}):\n\n${truncated}` },
          ],
          temperature: 0.1,
          max_tokens: 12000,
        });

        const cleaned = llmResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const extracted = JSON.parse(cleaned);

        // ── 4. Persist topics ──
        const topicCount = await persistTopics(sb, certification_id, extracted);
        totalTopics += topicCount;

        // Log the ingest run
        await sb.from("curriculum_ingest_runs").insert({
          certification_id,
          document_id: doc.id,
          run_type: "auto_pipeline",
          status: "success",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          metrics: {
            extracted_topics_count: topicCount,
            extraction_method: method,
            content_length: textContent.length,
            input_tokens: llmResult.usage?.input_tokens,
            output_tokens: llmResult.usage?.output_tokens,
            structure_type: extracted.structure_type,
          },
        });

        results.push({
          doc_id: doc.id,
          doc_type: doc.doc_type,
          topics: topicCount,
          method,
        });

        console.log(`[package-curriculum-ingest] Doc ${doc.id} (${doc.doc_type}): ${topicCount} topics extracted via ${method}`);
      } catch (docErr) {
        console.error(`[package-curriculum-ingest] Doc ${doc.id} failed:`, docErr);
        results.push({ doc_id: doc.id, error: (docErr as Error).message });
      }
    }

    // ── 5. Trigger auto-mapping ──
    try {
      await sb.functions.invoke("auto-map-topics-to-blueprint", {
        body: { certification_id },
      });
    } catch (mapErr) {
      console.warn("[package-curriculum-ingest] Auto-map failed (non-blocking):", mapErr);
    }

    // ── 6. Compute coverage ──
    try {
      await sb.rpc("compute_curriculum_coverage", { p_certification_id: certification_id });
      await sb.rpc("set_curriculum_hold_if_needed", { p_certification_id: certification_id });
    } catch (covErr) {
      console.warn("[package-curriculum-ingest] Coverage compute failed (non-blocking):", covErr);
    }

    // ── 7. Mark step as done ──
    if (step_id) {
      await sb.from("package_steps").update({
        status: totalTopics >= 5 ? "done" : "failed",
        last_error: totalTopics < 5 ? `Only ${totalTopics} topics extracted (min 5)` : null,
        finished_at: new Date().toISOString(),
        meta: { total_topics: totalTopics, documents_processed: results.length },
      }).eq("id", step_id);
    }

    return new Response(
      JSON.stringify({
        success: totalTopics >= 5,
        package_id,
        certification_id,
        total_topics: totalTopics,
        documents: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[package-curriculum-ingest] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
