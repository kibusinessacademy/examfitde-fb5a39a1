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
    // Load competencies
    const { data: lfIds } = await sb.from("learning_fields").select("id").eq("curriculum_id", curriculumId);
    const { data: competencies, error: compErr } = await sb
      .from("competencies")
      .select("id, title, description, learning_field_id")
      .in("learning_field_id", (lfIds || []).map((lf: { id: string }) => lf.id))
      .limit(100);
    if (compErr) throw new Error(`Competencies query: ${compErr.message}`);

    if (!competencies || competencies.length === 0) {
      throw new Error("No competencies found for curriculum – cannot generate oral exam blueprints");
    }

    // Idempotent rebuild
    await sb.from("oral_exam_blueprints").delete().eq("curriculum_id", curriculumId);

    // Generate blueprints
    const blueprintRows = competencies.slice(0, 30).map((comp: { id: string; title: string; description: string | null }) => ({
      curriculum_id: curriculumId,
      certification_id: certificationId,
      competency_id: comp.id,
      title: `Mündliche Prüfung: ${comp.title}`,
      scenario: `Der Prüfling soll im Rahmen eines Fachgesprächs nachweisen, dass er die Kompetenz "${comp.title}" beherrscht. ${comp.description || ""}`.trim(),
      lead_questions: [
        `Erklären Sie den Zusammenhang von "${comp.title}" in Ihrem Ausbildungsbetrieb.`,
        `Welche praktischen Erfahrungen haben Sie im Bereich "${comp.title}" gesammelt?`,
        `Beschreiben Sie eine konkrete Situation aus Ihrem Arbeitsalltag zu "${comp.title}".`,
      ],
      followups: [
        "Wie würden Sie in einer alternativen Situation vorgehen?",
        "Welche rechtlichen Grundlagen sind hier relevant?",
        "Wie bewerten Sie das Ergebnis Ihres Vorgehens?",
      ],
      rubric: {
        criteria: [
          { name: "Fachkompetenz", weight: 40, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
          { name: "Problemlösekompetenz", weight: 30, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
          { name: "Kommunikation", weight: 30, levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"] },
        ],
      },
      status: "approved",
    }));

    const { data: inserted, error: insertErr } = await sb
      .from("oral_exam_blueprints")
      .insert(blueprintRows)
      .select("id");
    if (insertErr) throw new Error(`oral_exam_blueprints insert: ${insertErr.message}`);
    if (!inserted || inserted.length === 0) {
      throw new Error("oral_exam_blueprints: 0 rows inserted – aborting");
    }

    // Sessionset
    const blueprintIds = inserted.map((x: { id: string }) => x.id);
    const { error: upErr } = await sb
      .from("oral_exam_sessionsets")
      .upsert(
        { package_id: packageId, title: "Oral Exam Set (auto)", blueprint_ids: blueprintIds },
        { onConflict: "package_id" }
      );
    if (upErr) throw new Error(`oral_exam_sessionsets upsert: ${upErr.message}`);

    return json({ ok: true, blueprints_created: inserted.length });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[OralExam] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
