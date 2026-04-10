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
  const FULFILLED = ["done", "skipped"];
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (!d1) return true;
  if (FULFILLED.includes(d1.status)) return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status ? FULFILLED.includes(d2.status) : false;
}

// ═══ Scenario Hashing for Deduplication ═══
async function hashScenario(text: string): Promise<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const data = new TextEncoder().encode(norm);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ═══ Scenario Variation Angles ═══
// For small curricula (few LFs), we inject diverse angles to force uniqueness
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
      {
        name: "Fachlichkeit", weight: 40,
        levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"],
        expectation_horizon: {
          sehr_gut: "Alle Fachbegriffe korrekt verwendet, tiefes Verständnis der Zusammenhänge, eigenständige Querverweise zu verwandten Themen, korrekte §§-/Normenreferenzen",
          gut: "Fachbegriffe überwiegend korrekt, gutes Verständnis, vereinzelte Querverweise",
          ausreichend: "Grundlegende Fachbegriffe bekannt, Zusammenhänge in Ansätzen erkannt",
          mangelhaft: "Fachbegriffe lückenhaft oder falsch, oberflächliches Verständnis",
        },
      },
      {
        name: "Struktur", weight: 25,
        levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"],
        expectation_horizon: {
          sehr_gut: "Klare Gliederung, logischer Argumentationsaufbau, souveräne Überleitung zwischen Aspekten",
          gut: "Erkennbare Gliederung, weitgehend logischer Aufbau",
          ausreichend: "Grundstruktur erkennbar, teilweise sprunghaft",
          mangelhaft: "Keine erkennbare Struktur, unzusammenhängend",
        },
      },
      {
        name: "Begriffssicherheit", weight: 20,
        levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"],
        expectation_horizon: {
          sehr_gut: "Fachterminologie durchgehend korrekt und präzise eingesetzt, Abgrenzung ähnlicher Begriffe sicher",
          gut: "Fachterminologie überwiegend korrekt, vereinzelte Unschärfen",
          ausreichend: "Grundbegriffe bekannt, häufiger Umgangssprache statt Fachsprache",
          mangelhaft: "Fachbegriffe falsch oder unbekannt, überwiegend Alltagssprache",
        },
      },
      {
        name: "Praxisbezug", weight: 15,
        levels: ["ungenügend", "mangelhaft", "ausreichend", "befriedigend", "gut", "sehr gut"],
        expectation_horizon: {
          sehr_gut: "Konkrete Praxisbeispiele aus dem eigenen Betrieb, eigenständige Transferleistung auf neue Situationen",
          gut: "Praxisbeispiele vorhanden, teilweise Transferleistung",
          ausreichend: "Allgemeine Praxisbezüge, kein eigenständiger Transfer",
          mangelhaft: "Kein erkennbarer Praxisbezug, rein theoretisch",
        },
      },
    ],
    scoring_guide: {
      points_per_criterion: "0-2 Punkte (0=ungenügend/mangelhaft, 1=ausreichend/befriedigend, 2=gut/sehr gut)",
      max_total: 10, pass_threshold: 5, excellence_threshold: 8,
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
    assertUuid("course_id", p?.course_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const courseId = p.course_id as string;
  const curriculumId = p.curriculum_id as string;
  const certificationId = p.certification_id || curriculumId;

  if (!(await prereqDone(sb, packageId, "validate_tutor_index"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_tutor_index" }, 409);
  }

  try {
    // ═══ STEP 1: Load Learning Fields ═══
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
    if (!competencies?.length) throw new Error("No competencies found");

    const compsByLf = new Map<string, typeof competencies>();
    for (const comp of competencies) {
      const lfId = (comp as any).learning_field_id;
      if (!compsByLf.has(lfId)) compsByLf.set(lfId, []);
      compsByLf.get(lfId)!.push(comp);
    }

    // ═══ STEP 3: Blueprint weights ═══
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

    // ═══ STEP 4: Proportional allocation ═══
    const MAX_BLUEPRINTS = 30;
    const MIN_SHARE = 0.06;

    const lfWeights: { lfId: string; lfTitle: string; weight: number; comps: typeof competencies }[] = [];
    let totalWeight = 0;
    for (const lf of learningFields) {
      const comps = compsByLf.get(lf.id) || [];
      if (comps.length === 0) continue;
      const w = weightByLf.get(lf.id) || (100 / learningFields.length);
      lfWeights.push({ lfId: lf.id, lfTitle: lf.title, weight: w, comps });
      totalWeight += w;
    }

    for (const lw of lfWeights) lw.weight = Math.max(lw.weight / totalWeight, MIN_SHARE);
    const normSum = lfWeights.reduce((s, lw) => s + lw.weight, 0);
    for (const lw of lfWeights) lw.weight /= normSum;

    const lfTargets = lfWeights.map(lw => ({
      ...lw,
      target: Math.max(1, Math.round(lw.weight * MAX_BLUEPRINTS)),
    }));

    let totalTarget = lfTargets.reduce((s, t) => s + t.target, 0);
    while (totalTarget > MAX_BLUEPRINTS) {
      const maxLf = lfTargets.reduce((a, b) => a.target > b.target ? a : b);
      maxLf.target--;
      totalTarget--;
    }

    // ═══ STEP 5: Load subtopics ═══
    const { data: allSubtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level, parent_topic_id")
      .eq("certification_id", curriculumId)
      .not("parent_topic_id", "is", null)
      .limit(500);
    const subtopicNames = (allSubtopics || []).map((t: any) => t.topic_name);

    // ═══ STEP 6: Idempotent rebuild ═══
    await sb.from("oral_exam_blueprints").delete().eq("curriculum_id", curriculumId);

    // ═══ STEP 7: Generate blueprints with DEDUPLICATION ═══
    const blueprintRows: any[] = [];
    const seenHashes = new Set<string>();
    let globalIdx = 0;
    const isSmallCurriculum = learningFields.length <= 6;

    for (const { lfId, lfTitle, comps, target } of lfTargets) {
      for (let i = 0; i < target; i++) {
        const comp = comps[i % comps.length];

        // Pick relevant subtopics
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

        // ═══ KEY FIX: Inject angle variation for small curricula ═══
        const angle = SCENARIO_ANGLES[globalIdx % SCENARIO_ANGLES.length];
        const anglePrefix = isSmallCurriculum
          ? `${angle.prefix}: `
          : "";
        const angleFocus = isSmallCurriculum
          ? ` Im Rahmen von ${angle.focus} soll der Prüfling nachweisen, dass er`
          : " Der Prüfling soll im Rahmen eines Fachgesprächs nachweisen, dass er";

        const scenario = `${anglePrefix}${angleFocus} die Kompetenz "${comp.title}" beherrscht. ${comp.description || ""}${topicContext}`.trim();

        // ═══ Dedup: hash-check before adding ═══
        const hash = await hashScenario(scenario);
        if (seenHashes.has(hash)) {
          // Generate alternative scenario with different subtopic offset
          const altOffset = (globalIdx * 7 + i * 13) % Math.max(1, subtopicNames.length);
          const altTopics = subtopicNames.slice(altOffset, altOffset + 3);
          const altTopicCtx = altTopics.length > 0
            ? `\n\nAlternative Fachaspekte:\n${altTopics.map((t: string) => `• ${t}`).join("\n")}`
            : "";
          const altAngle = SCENARIO_ANGLES[(globalIdx + 5) % SCENARIO_ANGLES.length];
          const altScenario = `${altAngle.prefix}: Im Kontext von ${altAngle.focus} demonstriert der Prüfling Kompetenz in "${comp.title}". ${comp.description || ""}${altTopicCtx}`.trim();
          const altHash = await hashScenario(altScenario);
          if (!seenHashes.has(altHash)) {
            seenHashes.add(altHash);
            // Use the alternative
            blueprintRows.push(buildBlueprint(curriculumId, certificationId, comp, lfId, altScenario, altHash, topicsForScenario.concat(altTopics), globalIdx));
            globalIdx++;
            continue;
          }
          // If even alt is duplicate, skip (don't pad with duplicates)
          console.warn(`[OralExam] Skipping duplicate scenario for comp=${comp.title.slice(0, 30)}, hash=${hash}`);
          globalIdx++;
          continue;
        }

        seenHashes.add(hash);
        blueprintRows.push(buildBlueprint(curriculumId, certificationId, comp, lfId, scenario, hash, topicsForScenario, globalIdx));
        globalIdx++;
      }
    }

    if (blueprintRows.length < 10) {
      throw new Error(`Only ${blueprintRows.length} unique blueprints generated (need ≥10). Curriculum may lack sufficient competency diversity.`);
    }

    console.log(`[OralExam] Generated ${blueprintRows.length} unique blueprints (${seenHashes.size} unique hashes) across ${lfTargets.length} LFs`);

    const { data: inserted, error: insertErr } = await sb
      .from("oral_exam_blueprints")
      .insert(blueprintRows)
      .select("id");
    if (insertErr) throw new Error(`oral_exam_blueprints insert: ${insertErr.message}`);
    if (!inserted || inserted.length === 0) throw new Error("oral_exam_blueprints: 0 rows inserted");

    // Sessionset
    const blueprintIds = inserted.map((x: { id: string }) => x.id);
    const { error: upErr } = await sb
      .from("oral_exam_sessionsets")
      .upsert(
        { package_id: packageId, title: "Oral Exam Set (auto)", blueprint_ids: blueprintIds },
        { onConflict: "package_id" }
      );
    if (upErr) throw new Error(`oral_exam_sessionsets upsert: ${upErr.message}`);

    // ═══ Session Templates ═══
    await sb.from("oral_exam_session_templates").delete().eq("package_id", packageId);

    const sessionTemplates = inserted.map((ins: { id: string }, idx: number) => {
      const bp = blueprintRows[idx];
      return {
        package_id: packageId,
        curriculum_id: curriculumId,
        blueprint_id: ins.id,
        title: bp.title,
        mode: idx < 10 ? "practice" : idx < 20 ? "exam_simulation" : "deep_dive",
        scenario: bp.scenario,
        lead_questions: bp.lead_questions,
        followup_questions: bp.followups,
        rubric: bp.rubric,
        time_limit_minutes: idx < 10 ? 15 : 20,
        difficulty: idx % 3 === 0 ? "easy" : idx % 3 === 1 ? "medium" : "hard",
        learning_field_id: bp.metadata?.learning_field_id || null,
        competency_id: bp.competency_id || null,
        sort_order: idx,
        metadata: {
          depth_enriched: bp.metadata?.depth_enriched || false,
          topic_count: bp.metadata?.topic_count || 0,
          scenario_hash: bp.metadata?.scenario_hash || null,
          generated_at: new Date().toISOString(),
        },
      };
    });

    const { data: sessInserted, error: sessErr } = await sb
      .from("oral_exam_session_templates")
      .insert(sessionTemplates)
      .select("id");
    if (sessErr) throw new Error(`session_templates insert: ${sessErr.message}`);

    const depthCount = blueprintRows.filter((b: any) => b.metadata?.depth_enriched).length;
    const sessCount = sessInserted?.length || 0;

    return json({
      ok: true, batch_complete: true,
      blueprints_created: inserted.length,
      sessions_created: sessCount,
      lf_coverage: lfTargets.length,
      depth_enriched: depthCount,
      unique_hashes: seenHashes.size,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[OralExam] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});

// ═══ Blueprint Row Builder ═══
function buildBlueprint(
  curriculumId: string, certificationId: string, comp: any,
  lfId: string, scenario: string, hash: string,
  topics: string[], idx: number,
) {
  // Pick 6 diverse followups using index-based rotation
  const followups: string[] = [];
  for (let f = 0; f < 6; f++) {
    followups.push(FOLLOWUP_POOLS[(idx * 3 + f) % FOLLOWUP_POOLS.length]);
  }
  // Add topic-specific followup if available
  if (topics.length > 2) {
    followups[3] = `Wie hängt ${topics[2]} mit Ihrer beschriebenen Situation zusammen?`;
  }

  return {
    curriculum_id: curriculumId,
    certification_id: certificationId,
    competency_id: comp.id,
    learning_field_id: lfId,
    title: `Mündliche Prüfung: ${comp.title}`,
    scenario,
    lead_questions: [
      `Erklären Sie den Zusammenhang von "${comp.title}" in Ihrem Ausbildungsbetrieb und gehen Sie dabei auf ${topics[0] || "relevante Fachaspekte"} ein.`,
      `Welche praktischen Erfahrungen haben Sie im Bereich "${comp.title}" gesammelt? Beschreiben Sie insbesondere ${topics[1] || "konkrete Arbeitsprozesse"}.`,
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
      nachhak_categories: ["Begründung", "Alternative", "Konsequenz", "Normbezug", "Transfer"],
    },
  };
}
