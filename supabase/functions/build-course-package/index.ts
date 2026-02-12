import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type StepKey =
  | "scaffold_learning_course"
  | "generate_minichecks"
  | "generate_exam_pool"
  | "build_exam_simulation"
  | "generate_oral_exam"
  | "build_ai_tutor_index"
  | "generate_handbook"
  | "run_integrity_check"
  | "auto_publish";

type BuildOptions = {
  include_learning_course?: boolean;
  include_exam_pool?: boolean;
  include_oral_exam?: boolean;
  include_ai_tutor?: boolean;
  include_handbook?: boolean;
  exam_target?: number;
  dry_run?: boolean;
};

const DEFAULT_OPTS: Required<BuildOptions> = {
  include_learning_course: true,
  include_exam_pool: true,
  include_oral_exam: true,
  include_ai_tutor: true,
  include_handbook: true,
  exam_target: 1000,
  dry_run: false,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries<T>(
  fn: () => Promise<T>,
  tries = 3,
  baseDelayMs = 400
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(baseDelayMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const {
    packageId,
    courseId,
    curriculumId,
    certificationId,
    options,
  } = await req.json().catch(() => ({}));

  if (!packageId || !curriculumId || !certificationId) {
    return json(
      { error: "Missing required: packageId, curriculumId, certificationId" },
      400
    );
  }

  const opts: Required<BuildOptions> = { ...DEFAULT_OPTS, ...(options || {}) };

  // 1) Acquire lock (package-level)
  const lockRes = await sb
    .from("course_package_locks")
    .insert({ package_id: packageId })
    .select("package_id")
    .maybeSingle();
  if (lockRes.error) {
    return json(
      { code: "PACKAGE_LOCKED", error: "Build already running for this package." },
      409
    );
  }

  const safeUnlock = async () => {
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  const setPackage = async (patch: Record<string, unknown>) => {
    await sb.from("course_packages").update(patch).eq("id", packageId);
  };

  const setStep = async (
    step_key: StepKey,
    status: "pending" | "running" | "done" | "failed",
    log: unknown = null
  ) => {
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId,
      p_step_key: step_key,
      p_status: status,
      p_log: log,
    });
  };

  try {
    await setPackage({ status: "building", build_progress: 1 });

    // 2) Load approved plan (SSOT) – hard gate
    const { data: planRow, error: planErr } = await sb
      .from("course_package_plans")
      .select("id, plan, status")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (planErr) throw planErr;
    if (!planRow) {
      await setPackage({ status: "failed" });
      return json(
        { error: "No approved course_package_plan found (Council approval required)." },
        400
      );
    }

    // 3) Ensure course exists
    let cid = courseId as string | null;
    if (!cid) {
      const { data: pkg, error: pkgErr } = await sb
        .from("course_packages")
        .select("course_id")
        .eq("id", packageId)
        .single();
      if (pkgErr) throw pkgErr;
      cid = (pkg as Record<string, unknown>).course_id as string | null;
    }
    if (!cid) {
      await setPackage({ status: "failed" });
      return json(
        { error: "Missing courseId and course_packages.course_id is null." },
        400
      );
    }

    const progress = async (p: number) => setPackage({ build_progress: p });

    // ---- STEP: scaffold_learning_course
    if (opts.include_learning_course) {
      await setStep("scaffold_learning_course", "running", {
        note: "Invoking generate-course",
      });
      if (!opts.dry_run) {
        await withRetries(async () => {
          const { error } = await sb.functions.invoke("generate-course", {
            body: { courseId: cid, curriculumId },
          });
          if (error) throw error;
        }, 3);
      }
      await setStep("scaffold_learning_course", "done", { ok: true });
      await progress(25);
    } else {
      await setStep("scaffold_learning_course", "done", { skipped: true });
    }

    // ---- STEP: generate_exam_pool (1000+)
    if (opts.include_exam_pool) {
      await setStep("generate_exam_pool", "running", {
        target: opts.exam_target,
      });
      if (!opts.dry_run) {
        await withRetries(async () => {
          const { data: bps, error: bpErr } = await sb
            .from("question_blueprints")
            .select("id, max_variations")
            .eq("curriculum_id", curriculumId)
            .eq("status", "approved");
          if (bpErr) throw bpErr;
          if (!bps?.length)
            throw new Error("No approved question_blueprints for curriculum");

          const per = Math.max(
            1,
            Math.ceil(opts.exam_target / bps.length)
          );
          for (let i = 0; i < bps.length; i++) {
            const bp = bps[i] as Record<string, unknown>;
            const cap =
              typeof bp.max_variations === "number" && (bp.max_variations as number) > 0
                ? (bp.max_variations as number)
                : per;
            const count = Math.min(per, cap);

            const { error } = await sb.functions.invoke(
              "generate-blueprint-questions",
              {
                body: {
                  blueprintId: bp.id,
                  count,
                  baseSeed: Date.now() + i,
                },
              }
            );
            if (error) throw error;
          }
        }, 2);
      }
      await setStep("generate_exam_pool", "done", { ok: true });
      await progress(55);
    } else {
      await setStep("generate_exam_pool", "done", { skipped: true });
    }

    // ---- STEP: generate_oral_exam
    if (opts.include_oral_exam) {
      await setStep("generate_oral_exam", "running", {
        note: "Creating oral_exam_sessionset",
      });
      if (!opts.dry_run) {
        await withRetries(async () => {
          const { data: oralBps, error: obErr } = await sb
            .from("oral_exam_blueprints")
            .select("id")
            .eq("curriculum_id", curriculumId)
            .eq("status", "approved")
            .limit(30);
          if (obErr) throw obErr;

          const blueprint_ids = (oralBps || []).map(
            (x: Record<string, unknown>) => x.id
          );

          await sb.from("oral_exam_sessionsets").insert({
            package_id: packageId,
            title: "Oral Exam Set (auto)",
            blueprint_ids,
          });
        }, 2);
      }
      await setStep("generate_oral_exam", "done", { ok: true });
      await progress(70);
    } else {
      await setStep("generate_oral_exam", "done", { skipped: true });
    }

    // ---- STEP: build_ai_tutor_index
    if (opts.include_ai_tutor) {
      await setStep("build_ai_tutor_index", "running", {
        note: "Create policy + index stats",
      });
      if (!opts.dry_run) {
        await withRetries(async () => {
          const policy = {
            allowed_sources: [
              "curriculum_topics",
              "lessons",
              "question_blueprints",
              "exam_sessions",
            ],
            forbid_invention: true,
            require_reference: true,
            modes: ["explainer", "coach", "examiner", "feedback"],
          };

          const { data: existing, error: exErr } = await sb
            .from("ai_tutor_policies")
            .select("id, version")
            .eq("curriculum_id", curriculumId)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (exErr) throw exErr;

          const nextVersion = existing?.version
            ? (existing.version as number) + 1
            : 1;

          await sb.from("ai_tutor_policies").insert({
            curriculum_id: curriculumId,
            policy,
            version: nextVersion,
          });

          const { count: lessonCount, error: lErr } = await sb
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .eq("course_id", cid);
          if (lErr) throw lErr;

          const { count: topicCount, error: tErr } = await sb
            .from("curriculum_topics")
            .select("id", { count: "exact", head: true })
            .eq("certification_id", certificationId);
          if (tErr) throw tErr;

          await sb.from("ai_tutor_context_index").insert({
            package_id: packageId,
            index_version: 1,
            stats: {
              lessonCount: lessonCount ?? 0,
              topicCount: topicCount ?? 0,
              policyVersion: nextVersion,
            },
          });
        }, 2);
      }
      await setStep("build_ai_tutor_index", "done", { ok: true });
      await progress(80);
    } else {
      await setStep("build_ai_tutor_index", "done", { skipped: true });
    }

    // ---- STEP: generate_handbook
    if (opts.include_handbook) {
      await setStep("generate_handbook", "running", {
        note: "Create chapters/sections (SSOT outline)",
      });
      if (!opts.dry_run) {
        await withRetries(async () => {
          const { data: topics, error: tpErr } = await sb
            .from("curriculum_topics")
            .select("id, topic_name, description, weight_percentage")
            .eq("certification_id", certificationId)
            .order("weight_percentage", { ascending: false })
            .limit(40);
          if (tpErr) throw tpErr;

          const chapterTitle = "Handbuch: Prüfungsrelevante Themen";
          const { data: chapter, error: chErr } = await sb
            .from("handbook_chapters")
            .insert({
              curriculum_id: curriculumId,
              title: chapterTitle,
              sort_order: 1,
            })
            .select("id")
            .single();
          if (chErr) throw chErr;

          let i = 1;
          for (const t of topics || []) {
            const topic = t as Record<string, unknown>;
            await sb.from("handbook_sections").insert({
              chapter_id: (chapter as Record<string, unknown>).id,
              title: String(topic.topic_name || "Thema"),
              content_md: [
                `## ${topic.topic_name}`,
                "",
                topic.description
                  ? String(topic.description)
                  : "_Beschreibung folgt (Council/LLM)._",
                "",
                `**Prüfungsgewichtung:** ${topic.weight_percentage ?? 0}%`,
                "",
                "### Typische Prüfungsfallen",
                "_Wird durch Council + Blueprint-Analyse ergänzt._",
              ].join("\n"),
              sort_order: i++,
            });
          }

          await sb.from("course_package_outputs").upsert(
            {
              package_id: packageId,
              output_key: "handbook_status",
              payload: {
                chapterTitle,
                sections: (topics || []).length,
                mode: "skeleton_ssot",
              },
            },
            { onConflict: "package_id,output_key" }
          );
        }, 2);
      }
      await setStep("generate_handbook", "done", { ok: true });
      await progress(88);
    } else {
      await setStep("generate_handbook", "done", { skipped: true });
    }

    // ---- STEP: run_integrity_check
    await setStep("run_integrity_check", "running", {
      note: "validate_course_integrity()",
    });
    if (!opts.dry_run) {
      const { data, error } = await sb.rpc("validate_course_integrity", {
        p_course_id: cid,
      });
      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      const ok = Boolean(result?.passed ?? result?.ok ?? false);
      if (!ok) throw new Error("Integrity failed");
    }
    await setStep("run_integrity_check", "done", { ok: true });
    await setPackage({
      integrity_passed: true,
      status: "qa",
      build_progress: 95,
    });

    // ---- STEP: auto_publish
    await setStep("auto_publish", "running", {
      note: "Set course published if integrity passed",
    });
    if (!opts.dry_run) {
      await sb
        .from("courses")
        .update({ publishing_status: "publish_ready", status: "ready" })
        .eq("id", cid);
    }
    await setStep("auto_publish", "done", { ok: true });

    await setPackage({
      status: "published",
      build_progress: 100,
      council_approved: true,
    });

    return json({ ok: true, packageId, courseId: cid, progress: 100 });
  } catch (e: unknown) {
    await sb
      .from("course_packages")
      .update({ status: "failed" })
      .eq("id", packageId);
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  } finally {
    await safeUnlock();
  }
});
