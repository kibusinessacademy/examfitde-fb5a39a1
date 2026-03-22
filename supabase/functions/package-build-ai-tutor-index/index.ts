import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data, error } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (error) throw error;
  return data?.status === "done";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
    assertUuid("curriculum_id", p?.curriculum_id);
    // certification_id is optional — curriculum_id is the SSOT for topic lookups
    // because curriculum_topics.certification_id stores curriculum IDs (not cert IDs)
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  // SSOT: curriculum_topics.certification_id actually stores curriculum_id values,
  // NOT the certification_id from course_packages. Always use curriculum_id for lookups.
  const topicLookupId = curriculumId;

  // Runner SSOT: prerequisites — Tutor now runs AFTER exam pool, BEFORE oral exam
  if (!(await prereqDone(sb, packageId, "validate_exam_pool"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_exam_pool" }, 409);
  }

  // Idempotent: check if already done for this package
  const { data: existingIdx, error: exErr } = await sb
    .from("ai_tutor_context_index").select("id")
    .eq("package_id", packageId).maybeSingle();
  if (exErr) throw exErr;

  // Policy: find or create for this curriculum
  const { data: existingPolicy, error: polQErr } = await sb
    .from("ai_tutor_policies").select("id, version")
    .eq("curriculum_id", curriculumId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (polQErr) throw polQErr;

  let policyVersion = existingPolicy?.version || 0;

  if (!existingPolicy) {
    policyVersion = 1;
    const policy = {
      forbid_invention: true,
      require_reference: true,
      allowed_sources: ["curriculum_topics", "lessons", "question_blueprints", "exam_sessions", "oral_exam_sessionsets"],
      modes: ["explainer", "coach", "examiner", "feedback"],
      binding_rule: "each answer must map to learning_field OR competency OR lesson OR exam_session OR curriculum_topic",
      depth_requirement: "tutor must reference curriculum_topics subtopics when answering domain-specific questions",
      lf_coverage_rule: "tutor must cover all learning fields proportionally, not just the first few",
    };
    const { error: polInsErr } = await sb.from("ai_tutor_policies").insert({
      curriculum_id: curriculumId, policy, version: policyVersion,
    });
    if (polInsErr) throw new Error(`Policy insert failed: ${polInsErr.message}`);
  }

  // Counts — now including curriculum_topics depth and LF coverage
  // Count lessons via modules (lessons has module_id, not course_id)
  const { data: modulesForCourse } = await sb
    .from("modules").select("id").eq("course_id", courseId);
  const modIds = (modulesForCourse || []).map((m: any) => m.id);
  const { count: lessonCount } = modIds.length > 0
    ? await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", modIds)
    : { count: 0 };

  // ═══ Fetch actual lesson content for retrieval chunks ═══
  let lessonChunks: { id: string; title: string; step: string; tokens_est: number }[] = [];
  if (modIds.length > 0) {
    const pageSize = 500;
    let offset = 0;
    while (true) {
      const { data: batch, error: batchErr } = await sb
        .from("lessons")
        .select("id, title, step, content")
        .in("module_id", modIds)
        .order("id")
        .range(offset, offset + pageSize - 1);
      if (batchErr) { console.error(`[AI-Tutor-Index] Lesson fetch error: ${batchErr.message}`); break; }
      if (!batch || batch.length === 0) break;
      for (const l of batch) {
        const contentStr = typeof l.content === "string" ? l.content : JSON.stringify(l.content || "");
        const tokensEst = Math.round(contentStr.length / 4);
        if (tokensEst > 10) {
          lessonChunks.push({ id: l.id, title: l.title || "", step: l.step || "", tokens_est: tokensEst });
        }
      }
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
  }
  console.log(`[AI-Tutor-Index] Lesson retrieval chunks: ${lessonChunks.length} (from ${lessonCount ?? 0} total lessons)`);

  // ═══ Fetch handbook sections as retrieval chunks ═══
  let handbookChunkCount = 0;
  let handbookTotalTokens = 0;
  try {
    const { data: hbChapters } = await sb
      .from("handbook_chapters")
      .select("id, title")
      .eq("curriculum_id", curriculumId);
    const chapterIds = (hbChapters || []).map((c: { id: string }) => c.id);
    if (chapterIds.length > 0) {
      const { data: sections } = await sb
        .from("handbook_sections")
        .select("id, content_markdown")
        .in("chapter_id", chapterIds);
      for (const s of sections || []) {
        const bodyLen = (s.content_markdown || "").length;
        if (bodyLen > 40) {
          handbookChunkCount++;
          handbookTotalTokens += Math.round(bodyLen / 4);
        }
      }
    }
  } catch (e) { console.warn(`[AI-Tutor-Index] Handbook fetch error: ${e}`); }
  console.log(`[AI-Tutor-Index] Handbook retrieval chunks: ${handbookChunkCount}`);

  const { count: topicCount } = await sb
    .from("curriculum_topics").select("id", { count: "exact", head: true }).eq("certification_id", topicLookupId);

  const { count: subtopicCount } = await sb
    .from("curriculum_topics").select("id", { count: "exact", head: true })
    .eq("certification_id", topicLookupId)
    .not("parent_topic_id", "is", null);

  // ═══ LF + Chapter coverage stats ═══
  // SSOT: Count LFs that have real lesson content (via modules join), NOT chapters
  const { data: lfData } = await sb
    .from("learning_fields").select("id")
    .eq("curriculum_id", curriculumId);
  const lfTotal = lfData?.length || 0;

  // Count LFs with at least one real lesson (content > 600 chars = not hollow)
  let lfCoverage = 0;
  if (lfData && lfData.length > 0) {
    const { data: coveredLfs } = await sb.rpc("count_lfs_with_real_content" as any, {
      p_curriculum_id: curriculumId,
      p_course_id: courseId,
    });
    lfCoverage = coveredLfs ?? 0;

    // Fallback: if RPC doesn't exist, count manually via modules
    if (lfCoverage === 0 && lfData.length > 0) {
      for (const lf of lfData) {
        const { count } = await sb
          .from("modules").select("id", { count: "exact", head: true })
          .eq("learning_field_id", lf.id)
          .eq("course_id", courseId);
        if ((count ?? 0) > 0) {
          // Check if any lesson in these modules has real content
          const { data: mods } = await sb
            .from("modules").select("id")
            .eq("learning_field_id", lf.id)
            .eq("course_id", courseId);
          if (mods && mods.length > 0) {
            const modIds = mods.map((m: any) => m.id);
            const { count: realCount } = await sb
              .from("lessons").select("id", { count: "exact", head: true })
              .in("module_id", modIds)
              .not("content", "is", null)
              .gt("content", "{}"); // non-empty JSON
            if ((realCount ?? 0) > 0) lfCoverage++;
          }
        }
      }
    }
  }

  // Handbook chapter count (for stats only, NOT for lf_coverage)
  const { data: hbChapters } = await sb
    .from("handbook_chapters").select("id")
    .eq("curriculum_id", curriculumId);
  const chapterTotal = hbChapters?.length || 0;

  // ═══ DEPTH GATE: Warn if no subtopics exist ═══
  const depthStatus = (subtopicCount ?? 0) > 0 ? "deep" : "shallow";
  if (depthStatus === "shallow") {
    console.warn(`[AI-Tutor-Index] ⚠️ No subtopics for topicLookupId ${topicLookupId} — tutor will have limited depth`);
  }

  // Context index (idempotent)
  const lessonContentChunks = lessonChunks.length;
  const totalChunks = lessonContentChunks + (topicCount ?? 0) + handbookChunkCount;
  const totalTokensEst = lessonChunks.reduce((s, c) => s + c.tokens_est, 0) + handbookTotalTokens + (topicCount ?? 0) * 300;
  const statsObj = {
    lessonCount: lessonCount ?? 0,
    lessonContentChunks,
    handbookChunkCount,
    topicCount: topicCount ?? 0,
    subtopicCount: subtopicCount ?? 0,
    lfTotal,
    chapterTotal,
    depthStatus,
    policyVersion,
    retrieval_sources: {
      lessons: { chunks: lessonContentChunks, tokens_est: lessonChunks.reduce((s, c) => s + c.tokens_est, 0) },
      handbook: { chunks: handbookChunkCount, tokens_est: handbookTotalTokens },
      topics: { chunks: topicCount ?? 0, tokens_est: (topicCount ?? 0) * 300 },
    },
    total_chunks: totalChunks,
    total_tokens_est: totalTokensEst,
    lf_coverage: lfCoverage,
    lf_total: lfTotal,
    avg_tokens_per_chunk: totalChunks > 0 ? Math.round(totalTokensEst / totalChunks) : 0,
  };

  if (!existingIdx) {
    const { error: idxErr } = await sb.from("ai_tutor_context_index").insert({
      package_id: packageId,
      index_version: 1,
      stats: statsObj,
    });
    if (idxErr) throw new Error(`Context index insert failed: ${idxErr.message}`);
  } else {
    await sb.from("ai_tutor_context_index").update({
      stats: statsObj,
      index_version: 2,
    }).eq("package_id", packageId);
  }

  // build_progress is now auto-computed by DB trigger from package_steps — no manual write needed

  return json({ ok: true, policyVersion, ...statsObj });
});
