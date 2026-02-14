import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
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

  // pipeline-runner handles step_start/step_done/step_fail.
  // Do NOT touch pipeline_lock / course_package_locks / update_course_package_step.

  try {
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
      const { error: delSecErr } = await sb.from("handbook_sections").delete().in("chapter_id", chapterIds);
      if (delSecErr) console.error(`[Handbook] Section delete warning: ${delSecErr.message}`);
      const { error: delChErr } = await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId);
      if (delChErr) console.error(`[Handbook] Chapter delete warning: ${delChErr.message}`);
    }

    // Step 3: Create chapters
    const TARGET_CHAPTERS = 5;
    const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
    const rawChunks: typeof fields[] = [];
    for (let i = 0; i < fields.length; i += chapterSize) {
      rawChunks.push(fields.slice(i, i + chapterSize));
    }
    while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
      const last = rawChunks.pop()!;
      rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
    }
    for (let pad = rawChunks.length + 1; rawChunks.length < TARGET_CHAPTERS; pad++) {
      rawChunks.push([]);
    }

    const chaptersToCreate = rawChunks.map((chunk, ci) => {
      const chapterNum = ci + 1;
      const firstCode = chunk.length > 0 ? (chunk[0] as any).code : `X${chapterNum}`;
      const lastCode = chunk.length > 0 ? (chunk[chunk.length - 1] as any).code : `X${chapterNum}`;
      const titleSuffix = chunk.length > 0
        ? `${firstCode}–${lastCode} Prüfungsrelevante Themen`
        : "Ergänzende Prüfungsthemen";
      return {
        curriculum_id: curriculumId,
        chapter_key: `handbuch-${curriculumId.slice(0, 8)}-kap${chapterNum}`,
        title: `Kapitel ${chapterNum}: ${titleSuffix}`,
        sort_order: chapterNum,
      };
    });

    const { data: chapters, error: chErr } = await sb
      .from("handbook_chapters")
      .insert(chaptersToCreate)
      .select("id, sort_order");
    if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
    if (!chapters || chapters.length === 0) {
      throw new Error("handbook_chapters: 0 rows inserted – aborting");
    }

    // Step 4: Create sections
    const fieldToChapter: number[] = [];
    for (let ci = 0; ci < rawChunks.length; ci++) {
      for (let fi = 0; fi < rawChunks[ci].length; fi++) {
        fieldToChapter.push(ci + 1);
      }
    }

    const sectionRows: Array<Record<string, unknown>> = [];
    let sectionOrder = 1;

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
          "### Kernthemen", "- _Wird durch Council + Curriculum-Analyse ergänzt._", "",
          "### Typische Prüfungsfallen", "- _Wird durch Council + Blueprint-Analyse ergänzt._", "",
          "### Praxisbeispiele", "- _Wird durch Council ergänzt._",
        ].join("\n"),
        content_type: "text",
        sort_order: sectionOrder++,
      });
    }

    if (sectionRows.length === 0) {
      throw new Error("handbook_sections: 0 sections prepared – aborting");
    }

    const { data: insertedSections, error: secErr } = await sb
      .from("handbook_sections")
      .insert(sectionRows)
      .select("id");
    if (secErr) throw new Error(`handbook_sections insert: ${secErr.message}`);
    if (!insertedSections || insertedSections.length === 0) {
      throw new Error("handbook_sections: 0 rows inserted – DB write failed");
    }

    // Record output
    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId, output_key: "handbook_status",
        payload: { curriculumId, chapters: chapters.length, sections: insertedSections.length, mode: "skeleton_ssot" },
      },
      { onConflict: "package_id,output_key" }
    );

    return json({ ok: true, chapters: chapters.length, sections: insertedSections.length });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[Handbook] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
