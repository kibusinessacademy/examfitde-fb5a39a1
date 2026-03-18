import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { isTransientLlmError } from "../_shared/llm/normalize.ts";
import { processLesson } from "../_shared/lesson-gen/process-lesson.ts";
import { bootstrapLLMLogging } from "../_shared/llm-log-bootstrap.ts";

/**
 * lesson-generate-content — Thin orchestrator (~40 lines)
 * All business logic lives in _shared/lesson-gen/*.ts
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  const startMs = Date.now();
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    bootstrapLLMLogging(sb, "lesson_generate_content");
    await assertSchemaReady("lesson-generate-content", sb);

    const body = await req.json().catch(() => ({}));
    const p = body.payload || body;

    return await processLesson(sb, p, startMs);
  } catch (outerErr) {
    const msg = (outerErr as Error).message || String(outerErr);
    const isTransient = isTransientLlmError(outerErr) ||
      msg.includes("timeout") || msg.includes("TIMEOUT") ||
      msg.includes("AbortError") || msg.includes("connection") ||
      msg.includes("fetch failed");
    console.error(`[lesson-gen] UNHANDLED: ${msg.slice(0, 300)}`);
    return new Response(JSON.stringify({
      ok: false,
      retry: isTransient,
      transient: isTransient,
      error: `UNHANDLED: ${msg.slice(0, 200)}`,
      elapsed_ms: Date.now() - startMs,
    }), {
      status: isTransient ? 503 : 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
