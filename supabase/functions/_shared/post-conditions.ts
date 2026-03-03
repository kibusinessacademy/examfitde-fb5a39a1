// supabase/functions/_shared/post-conditions.ts
// SSOT Post-Condition Guards: prevents "done" status on hollow content
type SB = any;

function num(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function assertStepPostConditions(sb: SB, args: {
  packageId: string;
  stepKey: string;
  expectedLessons?: number | null;
  track?: string | null;
}) {
  const { packageId, stepKey } = args;

  // ── generate_learning_content: lessons must be real, not placeholder shells ──
  if (stepKey === "generate_learning_content") {
    const { data, error } = await sb.rpc("package_lessons_realness", { p_package_id: packageId });
    if (error) throw error;

    const total = num(data?.lessons_total);
    const real  = num(data?.real_content);
    const ph    = num(data?.placeholders);
    const avg   = num(data?.avg_len);

    const expected = num(args.expectedLessons ?? total);
    const minReal = expected > 0 ? Math.max(1, Math.floor(expected * 0.95)) : 1;

    const ok =
      total > 0 &&
      ph === 0 &&
      real >= minReal &&
      avg >= 600;

    if (!ok) {
      const e: any = new Error("HOLLOW_LESSONS: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_LESSONS",
        lessons_total: total,
        expected_lessons: expected,
        real_content: real,
        placeholders: ph,
        avg_len: avg,
        min_real_required: minReal,
      };
      throw e;
    }
  }

  // ── generate_handbook: must have real chapter content (via course_id lookup) ──
  if (stepKey === "generate_handbook") {
    // Resolve course_id from package (handbook_chapters uses course_id, not package_id)
    const { data: pkg, error: pErr } = await sb
      .from("course_packages")
      .select("course_id")
      .eq("id", packageId)
      .single();
    if (pErr) throw pErr;

    const courseId = pkg?.course_id;
    const { data, error } = await sb
      .from("handbook_chapters")
      .select("id, content", { count: "exact" })
      .eq("course_id", courseId);
    if (error) throw error;

    const total = data?.length ?? 0;
    const realChapters = (data ?? []).filter(
      (ch: any) => typeof ch.content === "string" && ch.content.length > 500
    ).length;

    if (total === 0 || realChapters < Math.max(1, Math.floor(total * 0.9))) {
      const e: any = new Error("HOLLOW_HANDBOOK: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_HANDBOOK",
        chapters_total: total,
        chapters_real: realChapters,
      };
      throw e;
    }
  }

  // ── build_ai_tutor_index: must have index rows ──
  if (stepKey === "build_ai_tutor_index") {
    const { count, error } = await sb
      .from("ai_tutor_context_index")
      .select("id", { count: "exact", head: true })
      .eq("package_id", packageId);
    if (error) throw error;

    if ((count ?? 0) < 1) {
      const e: any = new Error("HOLLOW_TUTOR_INDEX: post-condition failed");
      e.__meta = {
        verdict: "HOLLOW_TUTOR_INDEX",
        index_rows: count ?? 0,
      };
      throw e;
    }
  }
}
