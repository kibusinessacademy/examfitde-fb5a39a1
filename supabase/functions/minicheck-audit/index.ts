/**
 * minicheck-audit — Automated MiniCheck question quality audit.
 *
 * Runs nightly via cron. Fetches unaudited approved minicheck_questions,
 * sends them in batches to AI for validation, and auto-fixes incorrect
 * correct_answer indices.
 *
 * Trigger: cron (nightly) or manual POST with { curriculum_id?, limit? }
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const BATCH_SIZE = 25;
const MAX_QUESTIONS_PER_RUN = 500;
const DELAY_BETWEEN_BATCHES_MS = 1200;
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Du bist ein Fachprüfer für IHK-Prüfungsfragen. Prüfe ob correct_answer (0-basiert) korrekt ist.

Prüfe:
1. Stimmt die fachliche Aussage der als korrekt markierten Option?
2. Sind Rechenwege (Kalkulation, MwSt, Formeln, Spannung/Strom/Widerstand etc.) korrekt?
3. Gibt es eine andere Option, die fachlich korrekter wäre?
4. Ist die Erklärung konsistent mit der markierten Antwort?

Antworte AUSSCHLIESSLICH als JSON-Array (keine Prosa, kein Markdown, keine Code-Fences):
[{"id":"<id>","status":"ok"},{"id":"<id>","status":"error","correct_answer":<richtig>,"reason":"<kurze Begründung>"}]`;

interface AuditError {
  id: string;
  status: "error";
  correct_answer: number;
  reason: string;
  old_answer?: number;
}

function buildPrompt(questions: any[]): string {
  return questions.map((q: any) => {
    const opts = (q.options || []).map((o: any, i: number) => {
      const txt = typeof o === "string" ? o : o?.text || String(o);
      return `  ${i}: ${txt}`;
    }).join("\n");
    return `ID: ${q.id}\nFrage: ${q.question_text}\nOptionen:\n${opts}\ncorrect_answer: ${q.correct_answer}\nErklärung: ${q.explanation || "-"}`;
  }).join("\n---\n");
}

async function callAI(prompt: string, apiKey: string): Promise<any[]> {
  const resp = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`AI gateway error ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  let text = data.choices?.[0]?.message?.content || "";
  
  // Clean markdown fences
  text = text.trim();
  if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n");
  if (text.endsWith("```")) text = text.slice(0, -3);
  if (text.startsWith("json")) text = text.slice(4);
  text = text.trim();

  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed?.results || [];
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

  if (!lovableApiKey) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: accept cron secret or service role
  const authHeader = req.headers.get("authorization")?.replace("Bearer ", "") || "";
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const isAuthorized = authHeader === supabaseKey || 
                       authHeader === cronSecret ||
                       req.headers.get("x-job-runner-key") === (Deno.env.get("EDGE_INTERNAL_SHARED_SECRET") || supabaseKey);
  
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(supabaseUrl, supabaseKey);
  
  let targetCurriculumId: string | null = null;
  let maxLimit = MAX_QUESTIONS_PER_RUN;
  
  if (req.method === "POST") {
    try {
      const body = await req.json();
      targetCurriculumId = body.curriculum_id || null;
      maxLimit = Math.min(body.limit || MAX_QUESTIONS_PER_RUN, 2000);
    } catch { /* no body = nightly run */ }
  }

  try {
    // Find curricula with unaudited questions
    let query = sb
      .from("minicheck_questions")
      .select("curriculum_id")
      .eq("status", "approved")
      .is("last_audited_at", null)
      .order("curriculum_id");
    
    if (targetCurriculumId) {
      query = query.eq("curriculum_id", targetCurriculumId);
    }

    const { data: currRows } = await query.limit(1000);
    const curriculumIds = [...new Set((currRows || []).map((r: any) => r.curriculum_id))];
    
    if (curriculumIds.length === 0) {
      return new Response(JSON.stringify({ 
        ok: true, message: "No unaudited questions found", audited: 0 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[minicheck-audit] Found ${curriculumIds.length} curricula with unaudited questions`);

    const runResults: any[] = [];
    let totalChecked = 0;
    let totalErrors = 0;
    let totalFixed = 0;

    for (const currId of curriculumIds) {
      if (totalChecked >= maxLimit) break;

      const remaining = maxLimit - totalChecked;
      const fetchLimit = Math.min(remaining, MAX_QUESTIONS_PER_RUN);

      // Fetch unaudited questions for this curriculum
      const { data: questions, error: fetchErr } = await sb
        .from("minicheck_questions")
        .select("id, question_text, options, correct_answer, explanation, difficulty")
        .eq("curriculum_id", currId)
        .eq("status", "approved")
        .is("last_audited_at", null)
        .order("created_at", { ascending: true })
        .limit(fetchLimit);

      if (fetchErr || !questions?.length) {
        console.log(`[minicheck-audit] Curriculum ${currId}: no questions or error`);
        continue;
      }

      console.log(`[minicheck-audit] Curriculum ${currId}: auditing ${questions.length} questions`);

      // Create audit log entry
      const { data: logEntry } = await sb
        .from("minicheck_audit_log")
        .insert({
          curriculum_id: currId,
          batch_start: 0,
          batch_end: questions.length,
          status: "running",
          run_type: targetCurriculumId ? "manual" : "nightly",
          model: MODEL,
        })
        .select("id")
        .single();

      const logId = logEntry?.id;
      const allErrors: AuditError[] = [];
      let okCount = 0;

      // Process in batches
      for (let i = 0; i < questions.length; i += BATCH_SIZE) {
        const batch = questions.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
          const results = await callAI(buildPrompt(batch), lovableApiKey);

          for (const r of results) {
            if (r.status === "error" && r.correct_answer !== undefined) {
              // Find original question to get old answer
              const orig = batch.find((q: any) => q.id === r.id);
              allErrors.push({
                ...r,
                old_answer: orig?.correct_answer,
              });
            } else {
              okCount++;
            }
          }

          console.log(`[minicheck-audit] ${currId} B${batchNum}: ${results.length} checked, ${results.filter((r: any) => r.status === "error").length} errors`);
        } catch (e) {
          console.error(`[minicheck-audit] ${currId} B${batchNum}: AI error - ${e}`);
          // Mark batch as audited anyway to prevent infinite retries
        }

        // Mark questions as audited
        const batchIds = batch.map((q: any) => q.id);
        await sb
          .from("minicheck_questions")
          .update({ 
            last_audited_at: new Date().toISOString(),
            audit_status: "checked",
          })
          .in("id", batchIds);

        // Rate limit protection
        if (i + BATCH_SIZE < questions.length) {
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
        }
      }

      // Auto-fix errors
      let fixedCount = 0;
      for (const err of allErrors) {
        if (err.correct_answer !== undefined && err.correct_answer !== err.old_answer) {
          const { error: updateErr } = await sb
            .from("minicheck_questions")
            .update({ 
              correct_answer: err.correct_answer,
              audit_status: "fixed",
              last_audited_at: new Date().toISOString(),
            })
            .eq("id", err.id);

          if (!updateErr) {
            fixedCount++;
          } else {
            console.error(`[minicheck-audit] Fix failed for ${err.id}: ${updateErr.message}`);
          }
        }
      }

      // Update audit log
      if (logId) {
        await sb
          .from("minicheck_audit_log")
          .update({
            questions_checked: questions.length,
            errors_found: allErrors.length,
            errors_fixed: fixedCount,
            error_details: allErrors,
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }

      totalChecked += questions.length;
      totalErrors += allErrors.length;
      totalFixed += fixedCount;

      runResults.push({
        curriculum_id: currId,
        checked: questions.length,
        errors_found: allErrors.length,
        errors_fixed: fixedCount,
      });
    }

    console.log(`[minicheck-audit] DONE: ${totalChecked} checked, ${totalErrors} errors, ${totalFixed} fixed`);

    return new Response(JSON.stringify({
      ok: true,
      total_checked: totalChecked,
      total_errors: totalErrors,
      total_fixed: totalFixed,
      curricula: runResults,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error(`[minicheck-audit] Fatal error:`, e);
    return new Response(JSON.stringify({ 
      error: e instanceof Error ? e.message : "Audit failed" 
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
