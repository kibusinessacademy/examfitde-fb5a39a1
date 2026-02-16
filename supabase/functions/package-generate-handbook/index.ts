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
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

/**
 * Load curriculum_topics depth for a learning field to enrich handbook sections.
 */
async function loadFieldTopicDepth(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  fieldCode: string,
  fieldTitle: string,
): Promise<string> {
  try {
    // Find parent topic matching this learning field
    const { data: parentTopics } = await sb
      .from("curriculum_topics")
      .select("id, topic_name")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .ilike("topic_name", `%${fieldTitle.slice(0, 30)}%`)
      .limit(3);

    if (!parentTopics?.length) {
      // Fallback: get ANY subtopics for this curriculum
      const { data: allParents } = await sb
        .from("curriculum_topics")
        .select("id, topic_name")
        .eq("certification_id", curriculumId)
        .is("parent_topic_id", null)
        .limit(50);
      if (!allParents?.length) return "";
      
      // Use all parents to gather subtopics
      const parentIds = allParents.map((p: any) => p.id);
      const { data: allSubs } = await sb
        .from("curriculum_topics")
        .select("topic_name, difficulty_level")
        .in("parent_topic_id", parentIds)
        .limit(200);
      
      if (!allSubs?.length) return "";
      return allSubs.map((s: any) => `- ${s.topic_name}`).join("\n");
    }

    const parentIds = parentTopics.map((t: any) => t.id);
    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level")
      .in("parent_topic_id", parentIds)
      .limit(50);

    if (!subtopics?.length) return "";
    return subtopics.map((s: any) => `- ${s.topic_name} (${s.difficulty_level || "mittel"})`).join("\n");
  } catch {
    return "";
  }
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

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;

  // Runner SSOT prerequisite
  if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
  }

  // 1) Load learning fields
  const { data: fields, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, description, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!fields || fields.length === 0) throw new Error(`No learning_fields for curriculum ${curriculumId}`);

  // 2) Delete existing handbook (idempotent rebuild)
  const { data: existingChapters } = await sb
    .from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);

  if (existingChapters?.length) {
    const chapterIds = existingChapters.map((x: { id: string }) => x.id);
    try { await sb.from("handbook_sections").delete().in("chapter_id", chapterIds); } catch (_) { /* ignore */ }
    try { await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId); } catch (_) { /* ignore */ }
  }

  // 3) Create chapters (target 5)
  const TARGET_CHAPTERS = 5;
  const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;

  const rawChunks: typeof fields[] = [];
  for (let i = 0; i < fields.length; i += chapterSize) rawChunks.push(fields.slice(i, i + chapterSize));
  while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
    const last = rawChunks.pop()!;
    rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
  }
  while (rawChunks.length < TARGET_CHAPTERS) rawChunks.push([]);

  const chaptersToCreate = rawChunks.map((chunk, idx) => {
    const chapterNum = idx + 1;
    const firstCode = chunk.length ? (chunk[0] as any).code : `X${chapterNum}`;
    const lastCode = chunk.length ? (chunk[chunk.length - 1] as any).code : `X${chapterNum}`;
    const titleSuffix = chunk.length ? `${firstCode}–${lastCode} Prüfungsrelevante Themen` : "Ergänzende Prüfungsthemen";
    return {
      curriculum_id: curriculumId,
      chapter_key: `handbuch-${curriculumId.slice(0, 8)}-kap${chapterNum}`,
      title: `Kapitel ${chapterNum}: ${titleSuffix}`,
      sort_order: chapterNum,
    };
  });

  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters").insert(chaptersToCreate).select("id, sort_order");
  if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
  if (!chapters?.length) throw new Error("handbook_chapters: 0 rows inserted");

  // Map field index -> chapter sort_order
  const fieldToChapter: number[] = [];
  for (let ci = 0; ci < rawChunks.length; ci++) {
    for (let fi = 0; fi < rawChunks[ci].length; fi++) fieldToChapter.push(ci + 1);
  }

  // 4) Create sections WITH DEPTH from curriculum_topics
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = 1;

  for (let i = 0; i < fields.length; i++) {
    const lf = fields[i] as any;
    const chapterSortOrder = fieldToChapter[i] || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    // ═══ DEPTH ENRICHMENT: Load subtopics from curriculum_topics ═══
    const subtopicList = await loadFieldTopicDepth(sb, curriculumId, lf.code, lf.title);

    const kernthemenBlock = subtopicList
      ? `### Kernthemen (aus dem Rahmenplan)\n${subtopicList}`
      : "### Kernthemen\n- _Wird durch Council + Curriculum-Analyse ergänzt._";

    sectionRows.push({
      chapter_id: chapter.id,
      section_key: `lf-${String(lf.code).toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
      title: `${lf.code}: ${lf.title}`,
      content_markdown: [
        `## ${lf.code}: ${lf.title}`, "",
        lf.description ? String(lf.description) : "_Beschreibung folgt (Council/LLM)._", "",
        kernthemenBlock, "",
        "### Typische Prüfungsfallen",
        "- _Wird durch Council + Blueprint-Analyse ergänzt._", "",
        "### Praxisbeispiele",
        "- _Wird durch Council ergänzt._",
      ].join("\n"),
      content_type: "text",
      sort_order: sectionOrder++,
      metadata: { depth_enriched: !!subtopicList },
    });
  }

  if (!sectionRows.length) throw new Error("handbook_sections: 0 sections prepared");
  const { error: secErr } = await sb.from("handbook_sections").insert(sectionRows);
  if (secErr) throw new Error(`Section insert: ${secErr.message}`);

  try { await sb.from("course_packages").update({ build_progress: 90 }).eq("id", packageId); } catch (_) { /* ignore */ }
  return json({ ok: true, chapters: chapters.length, sections: sectionRows.length, depth_enriched: sectionRows.filter((s: any) => s.metadata?.depth_enriched).length });
});
