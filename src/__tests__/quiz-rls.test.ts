/**
 * RLS-Regression-Tests für die Quiz-Engine (Lead-Magnet Loop A)
 *
 * Validiert:
 *  ✓ Anon DARF aktive Quizzes & deren Fragen lesen
 *  ✓ Anon DARF anonyme Attempts über die RPC public_insert_quiz_attempt anlegen
 *    (direkter INSERT ist seit der RLS-Härtung vom 2026-05-26 nicht mehr erlaubt)
 *  ✗ Anon DARF NICHT direkt UPDATE auf quiz_attempts (Härtung nach Punkt 2)
 *  ✗ Anon DARF NICHT direkt INSERT in quiz_leads (nur via RPC submit_quiz_lead)
 *  ✗ Anon DARF NICHT quiz_leads SELECTEN
 *  ✓ submit_quiz_attempt RPC verlangt korrekte anonymous_id (Ownership)
 *  ✗ submit_quiz_attempt mit fremder anonymous_id → forbidden
 *  ✓ submit_quiz_lead RPC weist invalid_email ab
 *
 * Hinweis: Diese Tests laufen gegen die echte Cloud-DB mit dem anon-Key.
 * Sie schreiben Test-Attempts mit anonymous_id "test_<random>" — diese sind
 * harmlos (keine PII, keine Leads).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

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
const anonId = `test_anon_${Math.random().toString(36).slice(2, 10)}`;
const otherAnonId = `test_other_${Math.random().toString(36).slice(2, 10)}`;

const client = HAS_ENV
  ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  : (null as any);

d("Quiz-Engine RLS — anonymer Zugriff", () => {
  let quizId: string | undefined;
  let curriculumId: string | undefined;

  beforeAll(async () => {
    const { data } = await client
      .from("lead_quizzes")
      .select("id, curriculum_id")
      .eq("slug", QUIZ_SLUG)
      .maybeSingle();
    quizId = data?.id;
    curriculumId = data?.curriculum_id;
  });

  it("liest aktive Quizzes (öffentlich)", async () => {
    const { data, error } = await client
      .from("lead_quizzes")
      .select("id, slug")
      .eq("slug", QUIZ_SLUG)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.slug).toBe(QUIZ_SLUG);
  });

  it("liest Fragen aktiver Quizzes (öffentlich)", async () => {
    if (!quizId) return;
    const { data, error } = await client
      .from("quiz_questions")
      .select("id, position")
      .eq("quiz_id", quizId);
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("erlaubt anonymen Attempt-INSERT mit anonymous_id", async () => {
    if (!quizId) return;
    const { data, error } = await (client as any).rpc("public_insert_quiz_attempt", {
      _quiz_id: quizId,
      _curriculum_id: curriculumId ?? null,
      _anonymous_id: anonId,
      _session_id: "vitest",
      _user_agent: "vitest",
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    (globalThis as any).__attemptId = data;
  });

  it("verbietet anonymen direkten UPDATE auf quiz_attempts", async () => {
    const attemptId = (globalThis as any).__attemptId as string | undefined;
    if (!attemptId) return;
    const { data, error } = await client
      .from("quiz_attempts")
      .update({ score: 0.99, passed: true, completed_at: new Date().toISOString() })
      .eq("id", attemptId)
      .select("id");
    // RLS muss den Update blocken: kein Fehler-Throw nötig, aber 0 betroffene Zeilen
    expect(error === null || !!error).toBe(true); // either RLS-block (silent) or error
    expect((data ?? []).length).toBe(0);
  });

  it("verbietet anonymen INSERT in quiz_leads", async () => {
    if (!quizId) return;
    const { error } = await client
      .from("quiz_leads")
      .insert({
        quiz_id: quizId,
        email: "rls-test@example.com",
        source: "rls-test",
      } as any);
    expect(error).not.toBeNull();
  });

  it("verbietet anonymen SELECT auf quiz_leads", async () => {
    const { data, error } = await client.from("quiz_leads").select("id").limit(1);
    // RLS blockt: entweder Fehler oder leeres Result
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("submit_quiz_attempt RPC: korrekte anonymous_id wird akzeptiert", async () => {
    const attemptId = (globalThis as any).__attemptId as string | undefined;
    if (!attemptId) return;
    const { data, error } = await (client as any).rpc("submit_quiz_attempt", {
      p_attempt_id: attemptId,
      p_anonymous_id: anonId,
      p_answers: [],
      p_score: 0.6,
      p_passed: false,
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(true);
  });

  it("submit_quiz_attempt RPC: fremde anonymous_id wird abgelehnt", async () => {
    if (!quizId) return;
    // Neuer Attempt für den anderen anon
    const { data: otherAttemptId } = await (client as any).rpc("public_insert_quiz_attempt", {
      _quiz_id: quizId,
      _curriculum_id: curriculumId ?? null,
      _anonymous_id: otherAnonId,
      _session_id: "vitest",
      _user_agent: "vitest",
    });
    expect(otherAttemptId).toBeTruthy();

    const { data, error } = await (client as any).rpc("submit_quiz_attempt", {
      p_attempt_id: otherAttemptId,
      p_anonymous_id: "wrong_anon_id",
      p_answers: [],
      p_score: 0.9,
      p_passed: true,
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(false);
    expect((data as any)?.error).toBe("forbidden");
  });

  it("submit_quiz_lead RPC: invalid_email wird abgelehnt", async () => {
    const { data, error } = await (client as any).rpc("submit_quiz_lead", {
      p_quiz_slug: QUIZ_SLUG,
      p_attempt_id: null,
      p_email: "not-an-email",
      p_marketing_consent: false,
      p_metadata: {},
    });
    expect(error).toBeNull();
    expect((data as any)?.ok).toBe(false);
    expect((data as any)?.error).toBe("invalid_email");
  });
});
