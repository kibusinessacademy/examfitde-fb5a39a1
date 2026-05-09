/**
 * package-seed-oral-blueprints
 *
 * Decoupled oral-exam-blueprint seeder. Runs the same blueprint construction
 * logic as `package-generate-oral-exam` but WITHOUT the `validate_tutor_index`
 * prerequisite — for packages whose tutor-index pipeline is delayed or
 * indefinitely blocked yet have all the upstream artifacts (learning_fields,
 * competencies, approved question_blueprints, exam_blueprints).
 *
 * Eligibility gate (hard):
 *   • ≥1 learning_field for the package's curriculum
 *   • ≥1 competency per LF (covered by allocator)
 *   • ≥10 approved question_blueprints (proxy for content quality)
 *   • EXAM_FIRST or EXAM_FIRST_PLUS track (oral exam included by profile)
 *
 * On success: writes oral_exam_blueprints + sessionsets + session_templates AND
 * marks `generate_oral_exam` step as `done` with meta.seed_bypass=true so the
 * downstream pipeline can resume without waiting for tutor-index.
 *
 * Audit: writes auto_heal_log row (action_type='manual_sustainable_heal_v1').
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

async function hashScenario(text: string): Promise<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const data = new TextEncoder().encode(norm);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

const SCENARIO_ANGLES = [
  { prefix: "Fallsituation – Beratungsgespräch", focus: "einem simulierten Beratungsgespräch" },
  { prefix: "Fallsituation – Problemlösung", focus: "einer konkreten Problemstellung im Betrieb" },
  { prefix: "Fallsituation – Planungsszenario", focus: "der Planung und Durchführung eines Arbeitsauftrags" },
  { prefix: "Fallsituation – Qualitätssicherung", focus: "der Qualitätskontrolle und Fehlervermeidung" },
  { prefix: "Fallsituation – Kundenkommunikation", focus: "der professionellen Kommunikation mit Kunden" },
  { prefix: "Fallsituation – Teamarbeit", focus: "der Zusammenarbeit im Team und Konfliktlösung" },
  { prefix: "Fallsituation – Wirtschaftlichkeit", focus: "wirtschaftlichen Überlegungen und Kostenanalyse" },
  { prefix: "Fallsituation – Rechtliche Grundlagen", focus: "der Anwendung relevanter Rechtsvorschriften" },
  { prefix: "Fallsituation – Arbeitssicherheit", focus: "Arbeitsschutz und Sicherheitsvorschriften" },
  { prefix: "Fallsituation – Innovation & Digitalisierung", focus: "digitalen Werkzeugen und modernen Arbeitsprozessen" },
  { prefix: "Fallsituation – Nachhaltigkeit", focus: "nachhaltigen und umweltbewussten Handeln im Beruf" },
  { prefix: "Fallsituation – Ausbildung & Anleitung", focus: "der Anleitung und Unterstützung von Kollegen oder Auszubildenden" },
];
const FOLLOWUP_POOLS = [
  "Wie würden Sie in einer alternativen Situation vorgehen? Begründen Sie Ihre Entscheidung fachlich.",
  "Welche rechtlichen Grundlagen und Vorschriften sind hier relevant?",
  "Wie bewerten Sie das Ergebnis Ihres Vorgehens? Welche Alternativen hätten Sie?",
  "Welche wirtschaftlichen Auswirkungen hat Ihre Entscheidung?",
  "Was wären die Konsequenzen, wenn Sie einen Fehler in diesem Bereich machen würden?",
  "Erklären Sie einem neuen Kollegen diesen Sachverhalt — wie gehen Sie vor?",
  "Welche Qualitätskriterien legen Sie zugrunde?",
  "Wie dokumentieren Sie Ihr Vorgehen und warum?",
  "Welche Rolle spielt die Digitalisierung in diesem Kontext?",
  "Wie stellen Sie sicher, dass Ihre Lösung nachhaltig ist?",
  "Nennen Sie mögliche Risiken und wie Sie diesen begegnen.",
  "Inwiefern beeinflusst Kundenfeedback Ihr Handeln in diesem Fall?",
];
function buildRubric() {
  return {
    criteria: [
      { name: "Fachlichkeit", weight: 40, levels: ["ungenügend","mangelhaft","ausreichend","befriedigend","gut","sehr gut"] },
      { name: "Struktur", weight: 25, levels: ["ungenügend","mangelhaft","ausreichend","befriedigend","gut","sehr gut"] },
      { name: "Begriffssicherheit", weight: 20, levels: ["ungenügend","mangelhaft","ausreichend","befriedigend","gut","sehr gut"] },
      { name: "Praxisbezug", weight: 15, levels: ["ungenügend","mangelhaft","ausreichend","befriedigend","gut","sehr gut"] },
    ],
    scoring_guide: { points_per_criterion: "0-2 Punkte", max_total: 10, pass_threshold: 5, excellence_threshold: 8 },
  };
}

function buildBlueprint(curriculumId: string, certificationId: string, comp: any, lfId: string, scenario: string, hash: string, topics: string[], idx: number, packageId: string) {
  const followups: string[] = [];
  for (let f = 0; f < 6; f++) followups.push(FOLLOWUP_POOLS[(idx * 3 + f) % FOLLOWUP_POOLS.length]);
  if (topics.length > 2) followups[3] = `Wie hängt ${topics[2]} mit Ihrer beschriebenen Situation zusammen?`;
  return {
    package_id: packageId,
    curriculum_id: curriculumId,
    certification_id: certificationId,
    competency_id: comp.id,
    learning_field_id: lfId,
    title: `Mündliche Prüfung: ${comp.title}`,
    scenario,
    lead_questions: [
      `Erklären Sie den Zusammenhang von "${comp.title}" und gehen Sie auf ${topics[0] || "relevante Fachaspekte"} ein.`,
      `Welche praktischen Erfahrungen haben Sie im Bereich "${comp.title}" gesammelt? Beschreiben Sie ${topics[1] || "konkrete Arbeitsprozesse"}.`,
      `Beschreiben Sie eine konkrete Situation aus Ihrem Arbeitsalltag zu "${comp.title}" und analysieren Sie die fachlichen Zusammenhänge.`,
    ],
    followups,
    rubric: buildRubric(),
    status: "approved",
    metadata: {
      depth_enriched: topics.length > 0,
      topic_count: topics.length,
      learning_field_id: lfId,
      scenario_hash: hash,
      seed_bypass: true,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }
  const packageId = p.package_id as string;

  try {
    // ── Resolve package context ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, curriculum_id, course_id, track, title, status")
      .eq("id", packageId)
      .maybeSingle();
    if (pkgErr) throw new Error(`pkg lookup: ${pkgErr.message}`);
    if (!pkg) throw new Error("PACKAGE_NOT_FOUND");
    const curriculumId = (pkg as any).curriculum_id as string;
    const certificationId = curriculumId;
    const courseId = (pkg as any).course_id as string;
    const track = String((pkg as any).track || "").toUpperCase();

    // ── Eligibility gate ──
    if (!["EXAM_FIRST","EXAM_FIRST_PLUS"].includes(track)) {
      throw new Error(`TRACK_NOT_ELIGIBLE: ${track} (oral exam not included)`);
    }
    const { count: bpApproved } = await sb
      .from("question_blueprints")
      .select("*", { count: "exact", head: true })
      .eq("package_id", packageId)
      .eq("status", "approved");
    if ((bpApproved ?? 0) < 10) {
      throw new Error(`PREREQ_INSUFFICIENT_BLUEPRINTS: ${bpApproved}/10 approved question_blueprints`);
    }

    // ── Load LFs / competencies / weights / subtopics ──
    const { data: learningFields, error: lfErr } = await sb
      .from("learning_fields")
      .select("id, code, title, sort_order")
      .eq("curriculum_id", curriculumId)
      .order("sort_order", { ascending: true });
    if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
    if (!learningFields?.length) throw new Error("PREREQ_NO_LEARNING_FIELDS");

    const lfIds = learningFields.map((lf: any) => lf.id);
    const { data: competencies, error: compErr } = await sb
      .from("competencies")
      .select("id, title, description, learning_field_id")
      .in("learning_field_id", lfIds)
      .limit(500);
    if (compErr) throw new Error(`Competencies query: ${compErr.message}`);
    if (!competencies?.length) throw new Error("PREREQ_NO_COMPETENCIES");

    const compsByLf = new Map<string, any[]>();
    for (const c of competencies) {
      const k = (c as any).learning_field_id;
      if (!compsByLf.has(k)) compsByLf.set(k, []);
      compsByLf.get(k)!.push(c);
    }

    const { data: blueprintWeights } = await sb
      .from("exam_blueprints")
      .select("learning_field_id, weight_pct")
      .eq("curriculum_id", curriculumId);
    const weightByLf = new Map<string, number>();
    for (const bw of (blueprintWeights || [])) {
      const k = (bw as any).learning_field_id;
      if (k) weightByLf.set(k, (bw as any).weight_pct || 0);
    }

    const totalCompetencies = competencies.length;
    const TARGET_BLUEPRINTS = Math.max(30, totalCompetencies);
    const MIN_SHARE = 0.06;

    const lfWeights: any[] = [];
    let totalWeight = 0;
    for (const lf of learningFields) {
      const comps = compsByLf.get(lf.id) || [];
      if (!comps.length) continue;
      const w = weightByLf.get(lf.id) || (100 / learningFields.length);
      lfWeights.push({ lfId: lf.id, lfTitle: lf.title, weight: w, comps });
      totalWeight += w;
    }
    for (const lw of lfWeights) lw.weight = Math.max(lw.weight / totalWeight, MIN_SHARE);
    const normSum = lfWeights.reduce((s, lw) => s + lw.weight, 0);
    for (const lw of lfWeights) lw.weight /= normSum;

    const lfTargets = lfWeights.map((lw: any) => ({
      ...lw,
      target: Math.max(lw.comps.length, Math.round(lw.weight * TARGET_BLUEPRINTS)),
    }));
    let totalTarget = lfTargets.reduce((s: number, t: any) => s + t.target, 0);
    while (totalTarget > TARGET_BLUEPRINTS) {
      const maxLf = lfTargets.reduce((a: any, b: any) => a.target > b.target ? a : b);
      if (maxLf.target <= maxLf.comps.length) break;
      maxLf.target--; totalTarget--;
    }

    const { data: allSubtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, parent_topic_id")
      .eq("certification_id", curriculumId)
      .not("parent_topic_id", "is", null)
      .limit(500);
    const subtopicNames = (allSubtopics || []).map((t: any) => t.topic_name);

    // ── Idempotent rebuild (per-package, NOT per-curriculum: avoid wiping siblings) ──
    await sb.from("oral_exam_blueprints").delete().eq("package_id", packageId);

    // ── Blueprint generation with dedup ──
    const rows: any[] = [];
    const seen = new Set<string>();
    let idx = 0;
    const small = learningFields.length <= 6;

    for (const { lfId, comps, target } of lfTargets) {
      for (let i = 0; i < target; i++) {
        const comp = comps[i % comps.length];
        const relevant = subtopicNames.filter((n: string) => {
          const w = comp.title.toLowerCase().split(/\s+/);
          return w.some((x: string) => x.length > 3 && n.toLowerCase().includes(x));
        }).slice(0, 5);
        const topics = relevant.length > 0
          ? relevant
          : subtopicNames.slice((idx*3)%Math.max(1,subtopicNames.length), (idx*3)%Math.max(1,subtopicNames.length) + 3);
        const angle = SCENARIO_ANGLES[idx % SCENARIO_ANGLES.length];
        const prefix = small ? `${angle.prefix}: ` : "";
        const focusClause = small
          ? ` Im Rahmen von ${angle.focus} soll der Prüfling nachweisen, dass er`
          : " Der Prüfling soll im Rahmen eines Fachgesprächs nachweisen, dass er";
        const ctx = topics.length ? `\n\nRelevante Fachthemen:\n${topics.map((t: string) => `• ${t}`).join("\n")}` : "";
        const scenario = `${prefix}${focusClause} die Kompetenz "${comp.title}" beherrscht. ${comp.description || ""}${ctx}`.trim();
        const h = await hashScenario(scenario);
        if (seen.has(h)) {
          const altOff = (idx * 7 + i * 13) % Math.max(1, subtopicNames.length);
          const alt = subtopicNames.slice(altOff, altOff + 3);
          const altCtx = alt.length ? `\n\nAlternative Fachaspekte:\n${alt.map((t: string) => `• ${t}`).join("\n")}` : "";
          const altAngle = SCENARIO_ANGLES[(idx + 5) % SCENARIO_ANGLES.length];
          const altScenario = `${altAngle.prefix}: Im Kontext von ${altAngle.focus} demonstriert der Prüfling Kompetenz in "${comp.title}". ${comp.description || ""}${altCtx}`.trim();
          const ah = await hashScenario(altScenario);
          if (!seen.has(ah)) {
            seen.add(ah);
            rows.push(buildBlueprint(curriculumId, certificationId, comp, lfId, altScenario, ah, topics.concat(alt), idx, packageId));
            idx++; continue;
          }
          idx++; continue;
        }
        seen.add(h);
        rows.push(buildBlueprint(curriculumId, certificationId, comp, lfId, scenario, h, topics, idx, packageId));
        idx++;
      }
    }

    // ── Coverage guarantee ──
    const covered = new Set(rows.map(r => r.competency_id));
    const missing = competencies.filter((c: any) => !covered.has(c.id));
    for (const c of missing) {
      const sc = `Der Prüfling soll im Fachgespräch nachweisen, dass er die Kompetenz "${c.title}" beherrscht. ${c.description || ""}`.trim();
      const h = await hashScenario(sc + c.id);
      seen.add(h);
      rows.push(buildBlueprint(curriculumId, certificationId, c, (c as any).learning_field_id, sc, h, [], rows.length, packageId));
    }
    if (rows.length < 10) throw new Error(`SEED_TOO_SMALL: only ${rows.length} unique blueprints (need ≥10)`);

    // ── Insert ──
    const { data: ins, error: insErr } = await sb.from("oral_exam_blueprints").insert(rows).select("id");
    if (insErr) throw new Error(`oral_exam_blueprints insert: ${insErr.message}`);
    const blueprintIds = (ins || []).map((x: any) => x.id);

    // ── Sessionset ──
    const { error: ssErr } = await sb.from("oral_exam_sessionsets").upsert(
      { package_id: packageId, title: "Oral Exam Set (seed)", blueprint_ids: blueprintIds },
      { onConflict: "package_id" }
    );
    if (ssErr) throw new Error(`oral_exam_sessionsets upsert: ${ssErr.message}`);

    // ── Session templates ──
    await sb.from("oral_exam_session_templates").delete().eq("package_id", packageId);
    const sessTpl = (ins || []).map((x: any, i: number) => {
      const bp = rows[i];
      return {
        package_id: packageId, curriculum_id: curriculumId, blueprint_id: x.id,
        title: bp.title,
        mode: i < 10 ? "practice" : i < 20 ? "exam_simulation" : "deep_dive",
        scenario: bp.scenario, lead_questions: bp.lead_questions,
        followup_questions: bp.followups, rubric: bp.rubric,
        time_limit_minutes: i < 10 ? 15 : 20,
        difficulty: i % 3 === 0 ? "easy" : i % 3 === 1 ? "medium" : "hard",
        learning_field_id: bp.learning_field_id, competency_id: bp.competency_id,
        sort_order: i,
        metadata: { seed_bypass: true, scenario_hash: bp.metadata?.scenario_hash },
      };
    });
    if (sessTpl.length) {
      const { error: stErr } = await sb.from("oral_exam_session_templates").insert(sessTpl);
      if (stErr) throw new Error(`session_templates insert: ${stErr.message}`);
    }

    // ── Mark generate_oral_exam step done (seed-bypass) ──
    await finalizeStepDone(sb, packageId, "generate_oral_exam", {
      blueprints_created: blueprintIds.length,
      sessions_created: sessTpl.length,
      unique_hashes: seen.size,
      seed_bypass: true,
      bypass_reason: "validate_tutor_index_blocked_but_artifacts_ready",
    });

    // ── Audit ──
    await sb.from("auto_heal_log").insert({
      action_type: "manual_sustainable_heal_v1",
      target_type: "package",
      target_id: packageId,
      trigger_source: "package-seed-oral-blueprints",
      result_status: "success",
      result_detail: `Seeded ${blueprintIds.length} oral blueprints (bypass validate_tutor_index)`,
      metadata: {
        package_id: packageId,
        blueprints: blueprintIds.length,
        sessions: sessTpl.length,
        track,
      },
    });

    return json({
      ok: true,
      blueprints_created: blueprintIds.length,
      sessions_created: sessTpl.length,
      lf_coverage: lfTargets.length,
      unique_hashes: seen.size,
      step_marked_done: "generate_oral_exam",
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[SeedOralBlueprints] ${msg}`);
    try {
      await finalizeStepFailed(sb, packageId, "generate_oral_exam", e);
    } catch { /* ignore */ }
    return json({ ok: false, error: msg }, 500);
  }
});
