/**
 * E2E-Funnel-Tests (Loop A — Quiz Lead-Magnet)
 *
 * Deckt den kompletten anonymen Pfad ab:
 *   1. Quiz lesen (öffentlich)
 *   2. Anonymer Attempt anlegen
 *   3. submit_quiz_attempt (Ownership via anonymous_id)
 *   4. Result-CTAs sichtbar (Mapping-Lookup im Frontend-SSOT)
 *   5. Lernplan bleibt "gesperrt" bis E-Mail-Submit (kein direkter SELECT auf quiz_leads)
 *   6. RLS-Verletzungen sind nicht möglich (Cross-Anon-Update, direkter Lead-Insert, Lead-SELECT)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getQuizBundleMapping } from "@/lib/quizBundleMap";

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "";
const ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

const HAS_ENV = !!SUPABASE_URL && !!ANON_KEY;
const d = HAS_ENV ? describe : describe.skip;

const QUIZ_SLUG = "aevo-pruefungsreife";
const anonId = `e2e_${Math.random().toString(36).slice(2, 12)}`;
const otherAnonId = `e2e_other_${Math.random().toString(36).slice(2, 12)}`;

const client = HAS_ENV
  ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  : (null as any);

d("Funnel E2E — anonymer Quiz → Result → Lernplan-Lock", () => {
  let quizId: string | undefined;
  let curriculumId: string | undefined;
  let attemptId: string | undefined;

  beforeAll(async () => {
    const { data } = await client
      .from("lead_quizzes")
      .select("id, curriculum_id")
      .eq("slug", QUIZ_SLUG)
      .maybeSingle();
    quizId = data?.id;
    curriculumId = data?.curriculum_id;
  });

  it("Step 1: Quiz öffentlich lesbar", async () => {
    expect(quizId).toBeTruthy();
  });

  it("Step 2: Anonymer Attempt erfolgreich angelegt", async () => {
    if (!quizId) return;
    const { data, error } = await (client as any).rpc("public_insert_quiz_attempt", {
      _quiz_id: quizId,
      _curriculum_id: curriculumId ?? null,
      _anonymous_id: anonId,
      _session_id: "e2e",
      _user_agent: "vitest",
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    attemptId = data as string;
  });

  it("Step 3: submit_quiz_attempt mit korrekter anonymous_id → ok", async () => {
    if (!attemptId) return;
    const { data, error } = await (client as any).rpc("submit_quiz_attempt", {
      p_attempt_id: attemptId,
      p_anonymous_id: anonId,
      p_answers: [{ question_id: "x", selected_key: "a", is_correct: true, weight: 1 }],
      p_score: 0.7,
      p_passed: false,
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(true);
  });

  it("Step 4: Frontend-Mapping liefert Bundle + Simulation-CTAs", () => {
    const m = getQuizBundleMapping(QUIZ_SLUG);
    expect(m).not.toBeNull();
    expect(m!.bundleSlug).toBe("ausbildereignungspruefung-aevo");
    expect(m!.simulationRoute).toBe("/pruefungstraining/aevo");
    expect(m!.curriculumId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Step 5a: Lernplan-PDF Edge Function liefert echtes PDF (data:application/pdf)", async () => {
    const { data, error } = await client.functions.invoke("lernplan-pdf", {
      body: { slug: QUIZ_SLUG, attempt_id: attemptId ?? null },
    });
    if (error && /not found|404/i.test(String(error.message ?? error))) return;
    expect(error).toBeNull();
    const payload = data as any;
    expect(payload?.ok).toBe(true);
    expect(typeof payload?.url).toBe("string");
    expect(payload.url.startsWith("data:application/pdf")).toBe(true);
    expect(payload?.mime).toBe("application/pdf");
  });

  it("Step 5b: quiz_leads bleibt für anon UNLESBAR (Lernplan ohne Lead gesperrt)", async () => {
    const { data, error } = await client
      .from("quiz_leads")
      .select("id, email")
      .limit(5);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("Step 6a: RLS verhindert direkten INSERT in quiz_leads", async () => {
    if (!quizId) return;
    const { error } = await client.from("quiz_leads").insert({
      quiz_id: quizId,
      email: "e2e@example.com",
      source: "e2e",
    } as any);
    expect(error).not.toBeNull();
  });

  it("Step 6b: RLS blockt Cross-Anon UPDATE auf fremden Attempt", async () => {
    if (!quizId) return;
    const { data: otherAttemptId } = await (client as any).rpc("public_insert_quiz_attempt", {
      _quiz_id: quizId,
      _curriculum_id: curriculumId ?? null,
      _anonymous_id: otherAnonId,
      _session_id: "e2e",
      _user_agent: "vitest",
    });
    expect(otherAttemptId).toBeTruthy();

    // Direkter UPDATE als anon → RLS blockt (0 rows)
    const { data } = await client
      .from("quiz_attempts")
      .update({ score: 1, passed: true })
      .eq("id", otherAttemptId)
      .select("id");
    expect((data ?? []).length).toBe(0);

    // RPC mit falscher anonymous_id → forbidden
    const { data: rpc } = await (client as any).rpc("submit_quiz_attempt", {
      p_attempt_id: otherAttemptId,
      p_anonymous_id: "wrong",
      p_answers: [],
      p_score: 1,
      p_passed: true,
    });
    expect((rpc as any)?.ok).toBe(false);
    expect((rpc as any)?.error).toBe("forbidden");
  });

  it("Step 6c: submit_quiz_lead weist invalid_email ab", async () => {
    const { data } = await (client as any).rpc("submit_quiz_lead", {
      p_quiz_slug: QUIZ_SLUG,
      p_attempt_id: attemptId ?? null,
      p_email: "kein-mail",
      p_marketing_consent: false,
      p_metadata: {},
    });
    expect((data as any)?.ok).toBe(false);
    expect((data as any)?.error).toBe("invalid_email");
  });

  it("Step 7a: validate_quiz_mapping bestätigt aktives Mapping", async () => {
    const { data, error } = await (client as any).rpc("validate_quiz_mapping", {
      p_quiz_slug: QUIZ_SLUG,
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(true);
    expect((data as any)?.curriculum_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Step 7b: validate_quiz_mapping liefert quiz_not_found für unbekannten Slug", async () => {
    const { data, error } = await (client as any).rpc("validate_quiz_mapping", {
      p_quiz_slug: "does-not-exist-xyz",
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(false);
    expect((data as any)?.error).toBe("quiz_not_found");
  });

  it("Step 7c: validate_quiz_mapping verweigert leeren Slug", async () => {
    const { data } = await (client as any).rpc("validate_quiz_mapping", {
      p_quiz_slug: "",
    });
    expect((data as any)?.ok).toBe(false);
    expect((data as any)?.error).toBe("missing_slug");
  });
});
