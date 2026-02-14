import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;

  const unlockFail = async (msg: string) => {
    await sb.from("course_packages").update({ status: "failed" }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "failed", p_log: { error: msg },
    });
    await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "running",
      p_log: { note: "Creating SSOT handbook skeleton from learning_fields" },
    });

    // Step 1: Load learning fields
    const { data: fields, error: lfErr } = await sb
      .from("learning_fields")
      .select("id, code, title, description, sort_order")
      .eq("curriculum_id", curriculumId)
      .order("sort_order", { ascending: true }).limit(50);
    if (lfErr) throw new Error(`LF query: ${lfErr.message}`);

    if (!fields || fields.length === 0) {
      throw new Error(`No learning_fields found for curriculum ${curriculumId} – cannot generate handbook`);
    }

    console.log(`[Handbook] Found ${fields.length} learning fields for curriculum ${curriculumId}`);

    // Step 2: Delete existing handbook for this curriculum (idempotent rebuild)
    const { data: existingChapters } = await sb
      .from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);

    if (existingChapters?.length) {
      const chapterIds = existingChapters.map((x: { id: string }) => x.id);
      // Delete sections first (FK constraint)
      const { error: delSecErr } = await sb.from("handbook_sections").delete().in("chapter_id", chapterIds);
      if (delSecErr) console.error(`[Handbook] Section delete warning: ${delSecErr.message}`);
      const { error: delChErr } = await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId);
      if (delChErr) console.error(`[Handbook] Chapter delete warning: ${delChErr.message}`);
    }

    // Step 3: Create chapters – dynamic grouping to reach TARGET_CHAPTERS
    const TARGET_CHAPTERS = 5;
    const chaptersToCreate = [];
    // Calculate chapterSize dynamically: e.g. 12 LFs / 5 target = ceil(2.4) = 3 per chapter → 4 chapters
    // We use floor to get more chapters: 12 / 5 = 2 per chapter → 6 groups, capped at TARGET
    const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
    const rawChunks: typeof fields[] = [];
    for (let i = 0; i < fields.length; i += chapterSize) {
      rawChunks.push(fields.slice(i, i + chapterSize));
    }
    // If we created more chunks than target, merge last two
    while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
      const last = rawChunks.pop()!;
      rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
    }
    // If we created fewer chunks than target (few LFs), pad with empty chapters
    for (let pad = rawChunks.length + 1; rawChunks.length < TARGET_CHAPTERS; pad++) {
      rawChunks.push([]); // empty chapter placeholder
    }

    for (let ci = 0; ci < rawChunks.length; ci++) {
      const chunk = rawChunks[ci];
      const chapterNum = ci + 1;
      const firstCode = chunk.length > 0 ? (chunk[0] as any).code : `X${chapterNum}`;
      const lastCode = chunk.length > 0 ? (chunk[chunk.length - 1] as any).code : `X${chapterNum}`;
      const titleSuffix = chunk.length > 0
        ? `${firstCode}–${lastCode} Prüfungsrelevante Themen`
        : "Ergänzende Prüfungsthemen";
      chaptersToCreate.push({
        curriculum_id: curriculumId,
        chapter_key: `handbuch-${curriculumId.slice(0, 8)}-kap${chapterNum}`,
        title: `Kapitel ${chapterNum}: ${titleSuffix}`,
        sort_order: chapterNum,
      });
    }

    console.log(`[Handbook] Will create ${chaptersToCreate.length} chapters (target: ${TARGET_CHAPTERS}, chapterSize: ${chapterSize}, LFs: ${fields.length})`);

    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters")
      .insert(chaptersToCreate)
      .select("id, sort_order");
    if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
    if (!chapters || chapters.length === 0) {
      throw new Error("handbook_chapters: 0 rows inserted – aborting");
    }

    console.log(`[Handbook] Created ${chapters.length} chapters`);

    // Step 4: Create sections for each learning field
    const sectionRows: Array<Record<string, unknown>> = [];
    let sectionOrder = 1;

    // Build a mapping from field index to chapter using the same chunking logic
    const fieldToChapter: number[] = [];
    for (let ci = 0; ci < rawChunks.length; ci++) {
      for (let fi = 0; fi < rawChunks[ci].length; fi++) {
        fieldToChapter.push(ci + 1); // sort_order is 1-based
      }
    }

    for (let i = 0; i < fields.length; i++) {
      const lf = fields[i] as { id: string; code: string; title: string; description: string | null; sort_order: number };
      const chapterSortOrder = fieldToChapter[i] || 1;
      const chapter = chapters.find((c: { sort_order: number }) => c.sort_order === chapterSortOrder);
      if (!chapter) continue;

      sectionRows.push({
        chapter_id: chapter.id,
        section_key: `lf-${lf.code.toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
        title: `${lf.code}: ${lf.title}`,
        content_markdown: [
          `## ${lf.code}: ${lf.title}`, "",
          lf.description ? String(lf.description) : "_Beschreibung folgt (Council/LLM)._", "",
          "### Kernthemen",
          "- _Wird durch Council + Curriculum-Analyse ergänzt._", "",
          "### Typische Prüfungsfallen",
          "- _Wird durch Council + Blueprint-Analyse ergänzt._", "",
          "### Praxisbeispiele",
          "- _Wird durch Council ergänzt._",
        ].join("\n"),
        content_type: "text",
        sort_order: sectionOrder++,
      });
    }

    if (sectionRows.length === 0) {
      throw new Error("handbook_sections: 0 sections prepared – aborting (learning_fields/chapter mapping failed)");
    }

    // Batch insert sections
    const { data: insertedSections, error: secErr } = await sb
      .from("handbook_sections")
      .insert(sectionRows)
      .select("id");

    if (secErr) throw new Error(`handbook_sections insert: ${secErr.message}`);
    if (!insertedSections || insertedSections.length === 0) {
      throw new Error("handbook_sections: 0 rows inserted despite prepared data – DB write failed");
    }

    console.log(`[Handbook] Created ${insertedSections.length} sections across ${chapters.length} chapters`);

    // Step 5: Record output
    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId, output_key: "handbook_status",
        payload: {
          curriculumId,
          chapters: chapters.length,
          sections: insertedSections.length,
          mode: "skeleton_ssot",
        },
      },
      { onConflict: "package_id,output_key" }
    );

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "generate_handbook", p_status: "done",
      p_log: { ok: true, chapters: chapters.length, sections: insertedSections.length },
    });
    await sb.from("course_packages").update({ build_progress: 88 }).eq("id", packageId);

    return json({ ok: true, chapters: chapters.length, sections: insertedSections.length });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[Handbook] Error: ${msg}`);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
