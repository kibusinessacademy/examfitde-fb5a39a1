/**
 * Unit test: SSE translation contract for the AI Tutor.
 *
 * Reproduces the OpenAI-429 → Anthropic-fallback scenario by feeding the
 * exact Anthropic native SSE bytes our gateway hands us and asserting
 * that:
 *   1. The client receives OpenAI-compatible SSE `data: {"choices":...}` lines.
 *   2. `fullResponse` (used for saveMessages + post-validation) is the
 *      concatenated plain text.
 *
 * Mirrors the production fix that wraps `content_block_delta` in OpenAI delta
 * shape and emits a final `[DONE]` so the client's loop terminates.
 *
 * Run: deno test supabase/functions/_shared/tutor/sse-translator.test.ts
 */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { translateSseStream, translateSseLine } from "./sse-translator.ts";

Deno.test("anthropic content_block_delta translates to OpenAI-compatible delta", () => {
  const line = `data: ${JSON.stringify({
    type: "content_block_delta",
    delta: { type: "text_delta", text: "Hallo" },
  })}`;
  const { clientChunk, fullDelta } = translateSseLine(line, "anthropic");
  assertEquals(fullDelta, "Hallo");
  assert(clientChunk.startsWith("data: "));
  const json = JSON.parse(clientChunk.slice(6).trim());
  assertEquals(json.choices[0].delta.content, "Hallo");
});

Deno.test("anthropic non-text events are ignored (no client emission)", () => {
  const ping = `data: ${JSON.stringify({ type: "ping" })}`;
  const start = `data: ${JSON.stringify({ type: "message_start", message: {} })}`;
  for (const line of [ping, start]) {
    const r = translateSseLine(line, "anthropic");
    assertEquals(r.clientChunk, "");
    assertEquals(r.fullDelta, "");
  }
});

Deno.test("openai SSE passes through unchanged + fullDelta extracted", () => {
  const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}`;
  const r = translateSseLine(line, "openai");
  assertEquals(r.fullDelta, "ok");
  assert(r.clientChunk.includes('"content":"ok"'));
});

Deno.test("full anthropic stream → openai stream + fullResponse populated", () => {
  // Realistic Anthropic SSE payload (3 text deltas + message_stop)
  const anthropicStream = [
    `event: message_start`,
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_1" } })}`,
    ``,
    `event: content_block_delta`,
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Die " } })}`,
    ``,
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Antwort " } })}`,
    ``,
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "lautet 42." } })}`,
    ``,
    `data: ${JSON.stringify({ type: "message_stop" })}`,
    ``,
  ].join("\n");

  const { clientStream, fullResponse } = translateSseStream(anthropicStream, "anthropic");

  // (1) fullResponse — what gets passed to saveMessages + ai_generations.output_content.
  assertEquals(fullResponse, "Die Antwort lautet 42.");

  // (2) clientStream — what the browser hook actually parses.
  const lines = clientStream.split("\n").filter((l) => l.startsWith("data: "));
  // 3 deltas + final [DONE]
  assertEquals(lines.length, 4);
  assertEquals(lines[3], "data: [DONE]");

  // Reassemble what the client-side OpenAI parser would collect.
  let clientAssembled = "";
  for (const l of lines) {
    const body = l.slice(6).trim();
    if (body === "[DONE]") continue;
    const parsed = JSON.parse(body);
    clientAssembled += parsed.choices?.[0]?.delta?.content ?? "";
  }
  assertEquals(clientAssembled, fullResponse);
});

Deno.test("simulated OpenAI 429 → Anthropic fallback: saveMessages payload matches", () => {
  // This is the exact scenario the production fix targets:
  // openai/gpt-4o-mini hits 429 → callAIWithFailover picks anthropic → server
  // must translate so that fullResponse (→ saveMessages, → post-validation)
  // and the client stream both contain real text.
  const fallbackStream = [
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Fallback OK" } })}`,
    ``,
  ].join("\n");

  const { clientStream, fullResponse } = translateSseStream(fallbackStream, "anthropic");

  // saveMessages would receive `fullResponse` — must NOT be empty.
  assert(fullResponse.length > 0, "fullResponse must not be empty after fallback");
  assertEquals(fullResponse, "Fallback OK");

  // Client must see OpenAI-shaped delta (else hook shows 'Keine Antwort erhalten').
  assert(clientStream.includes('"content":"Fallback OK"'));
  assert(clientStream.includes("data: [DONE]"));
});
