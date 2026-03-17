/**
 * json-parse-safe.ts — SSOT for robust LLM JSON response parsing.
 *
 * Handles: code fences, arrays, objects, truncation, trailing commas.
 * Use this everywhere LLM responses are parsed to avoid the "array vs object" bug.
 */

/**
 * Strip markdown code fences from LLM output.
 */
export function stripFences(text: string): string {
  return text
    .replace(/^[\s]*```(?:json)?[\s]*\n?/gi, "")
    .replace(/\n?[\s]*```[\s]*$/g, "")
    .replace(/```(?:json)?[\s]*/gi, "")
    .trim();
}

/**
 * Balanced extraction: finds the first `{` or `[` and counts brackets to find the matching close.
 * Handles truncated JSON by appending missing closers.
 *
 * @param text - Raw text possibly containing JSON
 * @param preferType - "auto" (default), "object", or "array"
 * @returns Parsed JSON or null
 */
export function extractBalancedJsonSafe(
  text: string,
  preferType: "auto" | "object" | "array" = "auto",
): any | null {
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  let start: number;
  let openChar: string;
  let closeChar: string;

  if (preferType === "object") {
    if (firstBrace === -1) return null;
    start = firstBrace;
    openChar = "{";
    closeChar = "}";
  } else if (preferType === "array") {
    if (firstBracket === -1) return null;
    start = firstBracket;
    openChar = "[";
    closeChar = "]";
  } else {
    // Auto-detect: whichever comes first
    if (firstBrace === -1 && firstBracket === -1) return null;
    if (firstBrace === -1) {
      start = firstBracket;
      openChar = "[";
      closeChar = "]";
    } else if (firstBracket === -1) {
      start = firstBrace;
      openChar = "{";
      closeChar = "}";
    } else if (firstBracket < firstBrace) {
      start = firstBracket;
      openChar = "[";
      closeChar = "]";
    } else {
      start = firstBrace;
      openChar = "{";
      closeChar = "}";
    }
  }

  // Balanced walk
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  // Truncated JSON — attempt repair
  const partial = text.slice(start);
  return repairTruncatedJson(partial);
}

/**
 * Repair truncated JSON by closing unclosed brackets/braces.
 */
function repairTruncatedJson(partial: string): any | null {
  const nestStack: string[] = [];
  let inString = false;
  let escape = false;

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

  if (nestStack.length === 0 && !inString) return null;

  let repaired = partial;
  // Clean up dangling tokens
  repaired = repaired.replace(/,\s*$/, "");
  repaired = repaired.replace(/:\s*$/, ": null");

  // Close open string
  if (inString) repaired += '"';

  // Close open brackets/braces in reverse order
  for (let i = nestStack.length - 1; i >= 0; i--) {
    repaired += nestStack[i] === "{" ? "}" : "]";
  }

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

/**
 * Full-pipeline JSON parser for LLM responses.
 * Steps: strip fences → direct parse → balanced extraction → trailing comma fix.
 *
 * @param raw - Raw LLM response string
 * @returns Parsed JSON or throws
 */
export function parseLlmJson(raw: string): any {
  const cleaned = stripFences(raw);

  // 1) Direct parse (fastest path)
  try {
    return JSON.parse(cleaned);
  } catch { /* fallthrough */ }

  // 2) Balanced extraction (handles leading text, arrays, objects)
  const balanced = extractBalancedJsonSafe(cleaned);
  if (balanced !== null) return balanced;

  // 3) Trailing comma fix
  const fixed = cleaned.replace(/,\s*([\]}])/g, "$1");
  try {
    return JSON.parse(fixed);
  } catch { /* fallthrough */ }

  // 4) lastIndexOf fallback (handles arrays and objects)
  const firstBracket = cleaned.indexOf("[");
  const firstBrace = cleaned.indexOf("{");

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lb = cleaned.lastIndexOf("]");
    if (lb > firstBracket) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lb + 1));
      } catch { /* fallthrough */ }
    }
  } else if (firstBrace !== -1) {
    const lb = cleaned.lastIndexOf("}");
    if (lb > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lb + 1));
      } catch { /* fallthrough */ }
    }
  }

  throw new Error("AI_JSON_PARSE_FAILED: No valid JSON found in response");
}
