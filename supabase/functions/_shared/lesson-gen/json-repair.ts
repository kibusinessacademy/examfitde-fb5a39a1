/**
 * lesson-gen/json-repair.ts — Stack-based balanced JSON extraction and repair
 * Self-contained, no external dependencies. Easy to unit-test.
 */

/**
 * Balanced-brace JSON extraction: finds the first { and counts braces to find matching }.
 * If JSON is truncated, attempts stack-based repair.
 */
export function extractBalancedJson(text: string): any | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }

  // Truncated JSON — repair using nesting stack
  const partial = text.slice(start);
  const nestStack: string[] = [];
  inString = false;
  escape = false;

  for (const ch of partial) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") nestStack.push("{");
    else if (ch === "}") nestStack.pop();
    else if (ch === "[") nestStack.push("[");
    else if (ch === "]") nestStack.pop();
  }

  if (nestStack.length > 0 || inString) {
    let repaired = partial;
    repaired = repaired.replace(/,\s*$/, "");
    repaired = repaired.replace(/:\s*$/, ": null");

    let strOpen = false;
    escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') strOpen = !strOpen;
    }
    if (strOpen) repaired += '"';

    for (let i = nestStack.length - 1; i >= 0; i--) {
      repaired += nestStack[i] === "{" ? "}" : "]";
    }

    try {
      const parsed = JSON.parse(repaired);
      console.log(`[lesson-gen] extractBalancedJson: repaired truncated JSON (stack depth=${nestStack.length})`);
      return parsed;
    } catch { /* noop */ }
  }

  return null;
}

/**
 * Parse LLM response content into structured JSON.
 * Tries: tool calls → fence-stripped JSON.parse → balanced extraction → HTML fallback → minicheck array extraction.
 */
export function parseLlmResponse(
  result: { content?: string; toolCalls?: any[] },
  isMiniCheck: boolean,
  lessonId: string,
): any | null {
  let content: any = null;

  // 1) Tool call parse
  if (result.toolCalls?.length > 0) {
    try { content = JSON.parse(result.toolCalls[0].function.arguments); } catch { /* fallthrough */ }
  }

  // 2) Fence-stripped direct parse
  const fenceStripped = result.content
    ? result.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
    : "";

  if (!content && fenceStripped) {
    try { content = JSON.parse(fenceStripped); } catch { /* fallthrough */ }
  }

  // 3) Balanced JSON extraction
  if (!content && fenceStripped) {
    content = extractBalancedJson(fenceStripped);
  }

  // 4) HTML fallback (non-minicheck only)
  if (!content && !isMiniCheck && fenceStripped && fenceStripped.length > 200) {
    if (fenceStripped.includes("<h3") || fenceStripped.includes("<p") || fenceStripped.includes("<strong")) {
      content = { html: fenceStripped, objectives: [] };
    }
  }

  // 5) MiniCheck array extraction
  if (!content && isMiniCheck && fenceStripped && fenceStripped.length > 200) {
    const qMatch = fenceStripped.match(/"questions"\s*:\s*\[/);
    if (qMatch && qMatch.index !== undefined) {
      let searchStart = fenceStripped.lastIndexOf("{", qMatch.index);
      if (searchStart === -1) searchStart = 0;
      const candidate = extractBalancedJson(fenceStripped.slice(searchStart));
      if (candidate?.questions && Array.isArray(candidate.questions)) {
        content = candidate;
        console.log(`[lesson-gen] Fallback4: extracted questions array (${candidate.questions.length} items) for ${lessonId.slice(0, 8)}`);
      }
    }
  }

  // P0-A: Sanitize double-serialized html
  if (content?.html && typeof content.html === "string") {
    const trimmed = content.html.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
      const cleaned = trimmed.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      try {
        const inner = JSON.parse(cleaned);
        if (inner.html && typeof inner.html === "string") {
          content.html = inner.html;
          content.objectives = content.objectives || inner.objectives || [];
          content.key_terms = content.key_terms || inner.key_terms || [];
          console.log(`[lesson-gen] P0-A: Unwrapped double-serialized content.html for ${lessonId.slice(0, 8)}`);
        }
      } catch { /* not JSON, leave as-is */ }
    }
  }

  return content;
}
