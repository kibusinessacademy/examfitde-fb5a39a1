import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * QC AI Analyze – Sends snapshot to AI for quality analysis.
 * Supports: Lovable AI (gateway), OpenAI, Anthropic
 * Admin-only. Streams response.
 */

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error, origin ?? undefined)
      : unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const { systemPrompt, userPrompt, provider, model } = await req.json();

    if (!systemPrompt || !userPrompt) {
      return new Response(JSON.stringify({ error: "systemPrompt and userPrompt required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let aiResponse: Response;

    if (provider === "lovable" || !provider) {
      // Lovable AI Gateway
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

      aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        }),
      });
    } else if (provider === "openai") {
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured. Add it in backend secrets.");

      aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        }),
      });
    } else if (provider === "anthropic") {
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured. Add it in backend secrets.");

      aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model || "claude-sonnet-4-20250514",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          stream: true,
        }),
      });
    } else {
      return new Response(JSON.stringify({ error: `Unknown provider: ${provider}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error(`[qc-ai-analyze] ${provider} error ${status}:`, errText);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI provider error (${status})` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For Anthropic, we need to transform the SSE format
    if (provider === "anthropic") {
      // Transform Anthropic's SSE to OpenAI-compatible format
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = aiResponse.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      (async () => {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx: number;
            while ((idx = buffer.indexOf("\n")) !== -1) {
              let line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              if (line.endsWith("\r")) line = line.slice(0, -1);
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  const openaiChunk = {
                    choices: [{ delta: { content: parsed.delta.text }, index: 0 }],
                  };
                  await writer.write(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
                }
                if (parsed.type === "message_stop") {
                  await writer.write(encoder.encode("data: [DONE]\n\n"));
                }
              } catch { /* skip */ }
            }
          }
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          console.error("[qc-ai-analyze] stream error:", e);
        } finally {
          writer.close();
        }
      })();

      return new Response(readable, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // OpenAI & Lovable: pass through SSE directly
    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("[qc-ai-analyze] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
