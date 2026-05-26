/**
 * Lesson-Join Parity Regression
 * --------------------------------------------------------------
 * Vergleicht Lesson-Counts pro Paket über zwei Pfade:
 *   A) Kanonisch:  curriculum_id → courses → modules → lessons
 *   B) Direkt:     course_packages.course_id → modules → lessons
 *
 * SSOT für admin_get_artifact_completeness ist Pfad A. Pfad B existiert
 * historisch und MUSS dieselben Counts liefern, sonst leakt eine Heal-
 * Empfehlung mit falschen "missing"-Werten.
 *
 * Der Test ruft admin_check_lesson_join_parity (SECURITY DEFINER, has_role)
 * — leerer Result-Set ⇒ Parity OK. Skip ohne TEST_ADMIN_JWT.
 */
import { describe, it, expect } from "vitest";

const SUPABASE_URL = "https://ubdvvvsiryenhrfmqsvw.supabase.co";
const ANON =
  "sb_publishable_3Z80G1ZZqFaK-wzNpNmaZA__1Tc6r8G";

const JWT = process.env.TEST_ADMIN_JWT;
const skipReason = !JWT
  ? "[skip] set TEST_ADMIN_JWT to run lesson-join parity regression"
  : null;

describe.skipIf(!!skipReason)("admin_check_lesson_join_parity", () => {
  it("returns no mismatches between curriculum-path and course_id-path lesson counts", async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/admin_check_lesson_join_parity`,
      {
        method: "POST",
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${JWT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_status: "published", p_limit: 500 }),
      },
    );
    expect(res.ok, `RPC HTTP ${res.status}`).toBe(true);
    const rows = (await res.json()) as Array<{
      package_id: string;
      title: string;
      via_curriculum: number;
      via_package_course: number;
      delta: number;
    }>;
    if (rows.length > 0) {
      // Surface the first 5 mismatches in the failure message.
      const sample = rows.slice(0, 5).map(
        (r) =>
          `${r.title} (${r.package_id}): curr=${r.via_curriculum} vs pkg=${r.via_package_course} Δ${r.delta}`,
      );
      throw new Error(
        `Lesson-join parity broken in ${rows.length} package(s):\n  - ${sample.join("\n  - ")}`,
      );
    }
    expect(rows.length).toBe(0);
  });
});
