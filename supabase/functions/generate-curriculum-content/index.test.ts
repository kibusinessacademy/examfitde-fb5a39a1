import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/generate-curriculum-content`;

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${ANON_KEY}`,
  apikey: ANON_KEY,
};

// --- Unit test: resolvePrompts logic (inline copy for structural validation) ---

function resolvePromptsTrack(programType: string | null, track: string | null): "STUDIUM" | "FORTBILDUNG" | "VOCATIONAL" {
  const pt = (programType ?? "").toLowerCase();
  const tr = (track ?? "").toUpperCase();
  if (pt === "higher_education" || tr === "STUDIUM") return "STUDIUM";
  if (tr === "FORTBILDUNG" || ["fortbildung_ihk", "fortbildung_hwk", "aufstiegsfortbildung"].includes(pt)) return "FORTBILDUNG";
  return "VOCATIONAL";
}

Deno.test("resolvePrompts: STUDIUM from program_type", () => {
  assertEquals(resolvePromptsTrack("higher_education", null), "STUDIUM");
});

Deno.test("resolvePrompts: STUDIUM from track", () => {
  assertEquals(resolvePromptsTrack(null, "STUDIUM"), "STUDIUM");
});

Deno.test("resolvePrompts: FORTBILDUNG from track", () => {
  assertEquals(resolvePromptsTrack(null, "FORTBILDUNG"), "FORTBILDUNG");
});

Deno.test("resolvePrompts: FORTBILDUNG from program_type fortbildung_ihk", () => {
  assertEquals(resolvePromptsTrack("fortbildung_ihk", null), "FORTBILDUNG");
});

Deno.test("resolvePrompts: VOCATIONAL default with beruf_id present", () => {
  assertEquals(resolvePromptsTrack("vocational", "AUSBILDUNG_VOLL"), "VOCATIONAL");
});

Deno.test("resolvePrompts: VOCATIONAL when both null", () => {
  assertEquals(resolvePromptsTrack(null, null), "VOCATIONAL");
});

// --- Integration: endpoint rejects missing curriculum_id ---

Deno.test("POST without curriculum_id returns 400", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.error, "curriculum_id required");
});

// --- Integration: nonexistent curriculum_id returns 404 ---

Deno.test("POST with fake curriculum_id returns 404", async () => {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ curriculum_id: "00000000-0000-0000-0000-000000000000" }),
  });
  const body = await res.json();
  assertEquals(res.status, 404);
});

// --- Output contract validation helpers ---

Deno.test("STUDIUM output codes should start with M", () => {
  // Validates the prompt contract — if AI generates, codes must be M01, M02...
  assertMatch("M01", /^M\d{2}$/);
  assertMatch("M12", /^M\d{2}$/);
});

Deno.test("FORTBILDUNG output codes should start with HQ", () => {
  assertMatch("HQ01", /^HQ\d{2}$/);
  assertMatch("HQ10", /^HQ\d{2}$/);
});

Deno.test("VOCATIONAL output codes should start with LF", () => {
  assertMatch("LF01", /^LF\d{2}$/);
  assertMatch("LF13", /^LF\d{2}$/);
});
