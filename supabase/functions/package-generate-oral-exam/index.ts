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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("course_id", p?.course_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;
  const curriculumId = p.curriculum_id as string;
  const certificationId = p.certification_id || curriculumId;

  if (!(await prereqDone(sb, packageId, "generate_exam_pool"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_exam_pool" }, 409);
  }

  try {
    // ═══ STEP 1: Load Learning Fields for proportional distribution ═══
    const { data: learningFields, error: lfErr } = await sb
      .from("learning_fields")
      .select("id, code, title, sort_order")
      .eq("curriculum_id", curriculumId)
      .order("sort_order", { ascending: true });
    if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
    if (!learningFields?.length) throw new Error("No learning_fields found for curriculum");

    // ═══ STEP 2: Load competencies grouped by LF ═══
    const lfIds = learningFields.map((lf: any) => lf.id);
    const { data: competencies, error: compErr } = await sb
      .from("competencies")
      .select("id, title, description, learning_field_id")
      .in("learning_field_id", lfIds)
      .limit(500);
    if (compErr) throw new Error(`Competencies query: ${compErr.message}`);
    if (!competencies?.length) throw new Error("No competencies found – cannot generate oral exam blueprints");

    // Group competencies by LF
    const compsByLf = new Map<string, typeof competencies>();
    for (const comp of competencies) {
      const lfId = (comp as any).learning_field_id;
      if (!compsByLf.has(lfId)) compsByLf.set(lfId, []);
      compsByLf.get(lfId)!.push(comp);
    }

    // ═══ STEP 3: Load exam blueprint weights for proportional allocation ═══
    const { data: blueprintWeights } = await sb
      .from("exam_blueprints")
      .select("learning_field_id, weight_pct")
      .eq("curriculum_id", curriculumId);

    const weightByLf = new Map<string, number>();
    if (blueprintWeights?.length) {
      for (const bw of blueprintWeights) {
        const lfId = (bw as any).learning_field_id;
        if (lfId) weightByLf.set(lfId, (bw as any).weight_pct || 0);
      }
    }

    // ═══ STEP 4: Calculate proportional blueprint targets per LF ═══
    const MAX_BLUEPRINTS = 30;
    const MIN_SHARE = 0.06; // each LF gets at least 6%

    // Assign weights: use blueprint weights if available, else equal distribution
    const lfWeights: { lfId: string; weight: number; comps: typeof competencies }[] = [];
    let totalWeight = 0;
    for (const lf of learningFields) {
      const comps = compsByLf.get(lf.id) || [];
      if (comps.length === 0) continue;
      const w = weightByLf.get(lf.id) || (100 / learningFields.length);
      lfWeights.push({ lfId: lf.id, weight: w, comps });
      totalWeight += w;
    }

    // Normalize and enforce minimum share
    for (const lw of lfWeights) {
      lw.weight = Math.max(lw.weight / totalWeight, MIN_SHARE);
    }
    const normSum = lfWeights.reduce((s, lw) => s + lw.weight, 0);
    for (const lw of lfWeights) lw.weight /= normSum;

    // Calculate target blueprints per LF (min 1)
    const lfTargets = lfWeights.map(lw => ({
      ...lw,
      target: Math.max(1, Math.round(lw.weight * MAX_BLUEPRINTS)),
    }));

    // Clamp total to MAX_BLUEPRINTS
    let totalTarget = lfTargets.reduce((s, t) => s + t.target, 0);
    while (totalTarget > MAX_BLUEPRINTS) {
      const maxLf = lfTargets.reduce((a, b) => a.target > b.target ? a : b);
      maxLf.target--;
      totalTarget--;
    }

    console.log(`[OralExam] Proportional distribution: ${lfTargets.map(t => `${t.lfId.slice(0, 8)}=${t.target}`).join(", ")}`);

    // ═══ STEP 5: Load subtopics for depth enrichment ═══
    const { data: allSubtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level, parent_topic_id")
      .eq("certification_id", curriculumId)
      .not("parent_topic_id", "is", null)
      .limit(500);
    const subtopicNames = (allSubtopics || []).map((t: any) => t.topic_name);

    // ═══ STEP 6: Idempotent rebuild ═══
    await sb.from("oral_exam_blueprints").delete().eq("curriculum_id", curriculumId);

    // ═══ STEP 7: Generate blueprints proportionally per LF ═══
    const blueprintRows: any[] = [];
    let globalIdx = 0;

    for (const { lfId, comps, target } of lfTargets) {
      // Select competencies for this LF: cycle through if target > comps.length
      for (let i = 0; i < target; i++) {
        const comp = comps[i % comps.length];

        // Pick relevant subtopics for this competency
        const relevantTopics = subtopicNames.filter((name: string) => {
          const compWords = comp.title.toLowerCase().split(/\s+/);
          const topicLower = name.toLowerCase();
          return compWords.some((w: string) => w.length > 3 && topicLower.includes(w));
        }).slice(0, 5);

        const topicsForScenario = relevantTopics.length > 0
          ? relevantTopics
          : subtopicNames.slice((globalIdx * 3) % Math.max(1, subtopicNames.length), (globalIdx * 3) % Math.max(1, subtopicNames.length) + 3);

        const topicContext = topicsForScenario.length > 0
          ? `\n\nRelevante Fachthemen aus dem Rahmenplan:\n${topicsForScenario.map((t: string) => `• ${t}`).join("\n")}`
          : "";

        blueprintRows.push({
          curriculum_id: curriculumId,
          certification_id: certificationId,
          competency_id: comp.id,
          title: `Mündliche Prüfung: ${comp.title}`,
          scenario: `Der Prüfling soll im Rahmen eines Fachgesprächs nachweisen, dass er die Kompetenz "${comp.title}" beherrscht. ${comp.description || ""}${topicContext}`.trim(),
          lead_questions: [
            `Erklären Sie den Zusammenhang von "${comp.title}" in Ihrem Ausbildungsbetrieb und gehen Sie dabei auf ${topicsForScenario[0] || "relevante Fachaspekte"} ein.`,
            `Welche praktischen Erfahrungen haben Sie im Bereich "${comp.title}" gesammelt? Beschreiben Sie insbesondere ${topicsForScenario[1] || "konkrete Arbeitsprozesse"}.`,
            `Beschreiben Sie eine konkrete Situation aus Ihrem Arbeitsalltag zu "${comp.title}" und analysieren Sie die fachlichen Zusammenhänge.`,
          ],
          followups: [
            "Wie würden Sie in einer alternativen Situation vorgehen? Begründen Sie Ihre Entscheidung fachlich.",
            "Welche rechtlichen Grundlagen und Vorschriften sind hier relevant?",
            "Wie bewerten Sie das Ergebnis Ihres Vorgehens? Welche Alternativen hätten Sie?",
            topicsForScenario.length > 2 ? `Wie hängt ${topicsForScenario[2]} mit Ihrer beschriebenen Situation zusammen?` : "Welche wirtschaftlichen Auswirkungen hat Ihre Entscheidung?",
          ],
          rubric: {
            criteria: [
              { name: "Fachkompetenz", weight: 40, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
              { name: "Problemlösekompetenz", weight: 30, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
              { name: "Kommunikation", weight: 30, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
            ],
          },
          status: "approved",
          metadata: { depth_enriched: topicsForScenario.length > 0, topic_count: topicsForScenario.length, learning_field_id: lfId },
        });
        globalIdx++;
      }
    }

    const { data: inserted, error: insertErr } = await sb
      .from("oral_exam_blueprints")
      .insert(blueprintRows)
      .select("id");
    if (insertErr) throw new Error(`oral_exam_blueprints insert: ${insertErr.message}`);
    if (!inserted || inserted.length === 0) throw new Error("oral_exam_blueprints: 0 rows inserted – aborting");

    // Sessionset
    const blueprintIds = inserted.map((x: { id: string }) => x.id);
    const { error: upErr } = await sb
      .from("oral_exam_sessionsets")
      .upsert(
        { package_id: packageId, title: "Oral Exam Set (auto)", blueprint_ids: blueprintIds },
        { onConflict: "package_id" }
      );
    if (upErr) throw new Error(`oral_exam_sessionsets upsert: ${upErr.message}`);

    const depthCount = blueprintRows.filter((b: any) => b.metadata?.depth_enriched).length;
    const lfCoverage = lfTargets.length;
    console.log(`[OralExam] Done: ${inserted.length} blueprints across ${lfCoverage} LFs, ${depthCount} depth-enriched`);

    return json({ ok: true, blueprints_created: inserted.length, lf_coverage: lfCoverage, depth_enriched: depthCount });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[OralExam] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
