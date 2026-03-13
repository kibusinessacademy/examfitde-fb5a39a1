import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * P1: Generate Lesson Shells
 * Creates 5 didactic-step lessons per competency for a given curriculum.
 * Pure SSOT – no LLM, no invented content.
 * 
 * Input: { curriculum_id, course_id?, dry_run? }
 * Output: { ok, created, skipped, errors }
 */

const STEPS = ["einstieg", "verstehen", "anwenden", "wiederholen", "mini_check"] as const;

interface ShellInput {
  curriculum_id: string;
  course_id?: string;
  dry_run?: boolean;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body: ShellInput = await req.json();

    if (!body.curriculum_id) {
      return json(400, { ok: false, error: "curriculum_id required" }, origin);
    }

    // 1) Resolve course
    let courseId = body.course_id;
    if (!courseId) {
      const { data: course } = await sb.from("courses")
        .select("id")
        .eq("curriculum_id", body.curriculum_id)
        .limit(1)
        .single();
      if (!course) return json(404, { ok: false, error: "No course found for curriculum" }, origin);
      courseId = course.id;
    }

    // 2) Load competencies via learning_fields
    const { data: comps, error: compErr } = await sb
      .from("competencies")
      .select("id, title, code, description, bloom_level, action_verb, learning_field_id, exam_relevance_tier")
      .in("learning_field_id",
        (await sb.from("learning_fields").select("id").eq("curriculum_id", body.curriculum_id)).data?.map((lf: { id: string }) => lf.id) ?? []
      );

    if (compErr) throw compErr;
    if (!comps?.length) return json(404, { ok: false, error: "No competencies found" }, origin);

    // 3) Load or create modules (1 per learning_field)
    const { data: existingModules } = await sb.from("modules")
      .select("id, learning_field_id")
      .eq("course_id", courseId);

    const lfToModule = new Map<string, string>();
    for (const m of existingModules ?? []) {
      if (m.learning_field_id) lfToModule.set(m.learning_field_id, m.id);
    }

    // Auto-create missing modules from learning_fields
    const { data: lfs } = await sb.from("learning_fields")
      .select("id, code, title, sort_order")
      .eq("curriculum_id", body.curriculum_id)
      .order("sort_order");

    for (const lf of lfs ?? []) {
      if (!lfToModule.has(lf.id)) {
        const { data: newMod, error: modErr } = await sb.from("modules").insert({
          course_id: courseId,
          learning_field_id: lf.id,
          title: `${lf.code}: ${lf.title}`,
          sort_order: lf.sort_order ?? 0,
          learning_field_code: lf.code,
        }).select("id").single();
        if (modErr) {
          console.error(`[generate-lesson-shells] module create error for LF ${lf.code}:`, modErr.message);
        } else if (newMod) {
          lfToModule.set(lf.id, newMod.id);
        }
      }
    }

    // 4) Check existing lessons
    // FIX: Add .limit(5000) to avoid Supabase 1000-row default limit
    const { data: existingLessons } = await sb.from("lessons")
      .select("competency_id, step")
      .in("module_id", [...lfToModule.values()])
      .limit(5000);

    const existingSet = new Set(
      (existingLessons ?? []).map((l: { competency_id: string; step: string }) => `${l.competency_id}::${l.step}`)
    );

    // 5) Generate shells
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const batch: Record<string, unknown>[] = [];

    for (const comp of comps) {
      const moduleId = lfToModule.get(comp.learning_field_id);
      if (!moduleId) {
        errors.push(`No module for LF ${comp.learning_field_id} (comp ${comp.code})`);
        continue;
      }

      for (let i = 0; i < STEPS.length; i++) {
        const step = STEPS[i];
        const key = `${comp.id}::${step}`;

        if (existingSet.has(key)) {
          skipped++;
          continue;
        }

        const content = buildShellContent(comp, step);

        batch.push({
          module_id: moduleId,
          competency_id: comp.id,
          title: `${comp.code}: ${comp.title}`,
          step,
          sort_order: i + 1,
          status: "draft",
          content,
          published_versions: { versions: [] },
        });
      }
    }

    if (body.dry_run) {
      return json(200, { ok: true, dry_run: true, would_create: batch.length, skipped, errors }, origin);
    }

    // Batch insert in chunks of 200
    const CHUNK = 200;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const chunk = batch.slice(i, i + CHUNK);
      const { error: insertErr } = await sb.from("lessons").insert(chunk);
      if (insertErr) {
        errors.push(`Insert chunk ${i}: ${insertErr.message}`);
      } else {
        created += chunk.length;
      }
    }

    return json(200, {
      ok: true,
      curriculum_id: body.curriculum_id,
      course_id: courseId,
      competencies: comps.length,
      created,
      skipped,
      errors,
    }, origin);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-lesson-shells] error:", msg);
    return json(500, { ok: false, error: msg }, origin);
  }
});

/* ── Shell Content Builders ── */

function buildShellContent(
  comp: { title: string; code: string; description: string | null; bloom_level: string | null; action_verb: string | null; exam_relevance_tier: string | null },
  step: string
): Record<string, unknown> {
  const base = {
    type: "text",
    _placeholder: false,
    _ssot_generated: true,
    _step: step,
    _competency_code: comp.code,
    _bloom_level: comp.bloom_level ?? "unknown",
    _exam_tier: comp.exam_relevance_tier ?? "unknown",
  };

  switch (step) {
    case "einstieg":
      return {
        ...base,
        html: buildEinstiegHtml(comp),
        objectives: [`Aktivierung: ${comp.title}`],
        didactic_type: "scenario_hook",
      };

    case "verstehen":
      return {
        ...base,
        html: buildVerstehenHtml(comp),
        objectives: extractObjectives(comp),
        didactic_type: "core_concepts",
      };

    case "anwenden":
      return {
        ...base,
        html: buildAnwendenHtml(comp),
        objectives: [`Anwendung: ${comp.title}`],
        didactic_type: "guided_application",
      };

    case "wiederholen":
      return {
        ...base,
        html: buildWiederholenHtml(comp),
        objectives: [`Retrieval: ${comp.title}`],
        didactic_type: "spaced_recall",
      };

    case "mini_check":
      return {
        ...base,
        html: buildMinicheckHtml(comp),
        objectives: [`Überprüfung: ${comp.title}`],
        didactic_type: "minicheck_link",
      };

    default:
      return { ...base, html: `<p>${comp.title}</p>`, objectives: [] };
  }
}

function buildEinstiegHtml(c: { title: string; description: string | null; action_verb: string | null }): string {
  const verb = c.action_verb ? `<em>${c.action_verb}</em>` : "";
  return `<div class="lesson-shell step-einstieg">
<h3>🎯 Einstieg: ${c.title}</h3>
${verb ? `<p><strong>Handlungsverb:</strong> ${verb}</p>` : ""}
<div class="scenario-hook">
<p><strong>Praxisszenario:</strong> Stellen Sie sich vor, Sie sind in Ihrem Ausbildungsbetrieb und stehen vor folgender Situation:</p>
<blockquote>${c.description ?? c.title}</blockquote>
<p><em>Was würden Sie als Erstes tun?</em></p>
</div>
</div>`;
}

function buildVerstehenHtml(c: { title: string; description: string | null; bloom_level: string | null }): string {
  return `<div class="lesson-shell step-verstehen">
<h3>📚 Verstehen: ${c.title}</h3>
<div class="core-concepts">
<p><strong>Bloom-Level:</strong> ${c.bloom_level ?? "–"}</p>
<h4>Kernkonzepte</h4>
<ul>
${c.description ? `<li>${c.description}</li>` : `<li>${c.title}</li>`}
</ul>
<div class="case-vignette">
<p><strong>Fallvignette:</strong> <em>Wird im nächsten Schritt aus SSOT-Daten generiert.</em></p>
</div>
</div>
</div>`;
}

function buildAnwendenHtml(c: { title: string; action_verb: string | null }): string {
  return `<div class="lesson-shell step-anwenden">
<h3>🔧 Anwenden: ${c.title}</h3>
<div class="guided-application">
<p><strong>Aufgabe:</strong> Wenden Sie Ihr Wissen zu <em>${c.title}</em> an:</p>
<ol>
<li>Beschreiben Sie die wesentlichen Schritte${c.action_verb ? ` zum <em>${c.action_verb}</em>` : ""}.</li>
<li>Identifizieren Sie mögliche Fehlerquellen.</li>
<li>Begründen Sie Ihre Vorgehensweise fachlich.</li>
</ol>
</div>
</div>`;
}

function buildWiederholenHtml(c: { title: string; description: string | null }): string {
  return `<div class="lesson-shell step-wiederholen">
<h3>🔄 Wiederholen: ${c.title}</h3>
<div class="spaced-recall">
<h4>3 Leitfragen zum Retrieval</h4>
<ol>
<li>Nennen Sie die drei wichtigsten Aspekte von <em>${c.title}</em>.</li>
<li>Grenzen Sie <em>${c.title}</em> von verwandten Konzepten ab.</li>
<li>In welchen Prüfungssituationen ist dieses Wissen besonders relevant?</li>
</ol>
<h4>Abgrenzungstabelle</h4>
<table>
<tr><th>Merkmal</th><th>${c.title}</th><th>Verwandtes Konzept</th></tr>
<tr><td>Definition</td><td>—</td><td>—</td></tr>
<tr><td>Anwendung</td><td>—</td><td>—</td></tr>
<tr><td>Prüfungsrelevanz</td><td>—</td><td>—</td></tr>
</table>
</div>
</div>`;
}

function buildMinicheckHtml(c: { title: string; code: string }): string {
  return `<div class="lesson-shell step-minicheck">
<h3>✅ MiniCheck: ${c.title}</h3>
<div class="minicheck-link">
<p>Der MiniCheck wird automatisch aus dem Elite-Fragenpool zusammengestellt.</p>
<p><strong>Kompetenz:</strong> ${c.code} – ${c.title}</p>
<p><em>7–8 Items · Elite/Advanced-Mix · IHK-nahe Distraktoren</em></p>
</div>
</div>`;
}

function extractObjectives(c: { title: string; description: string | null }): string[] {
  const objs = [`Verständnis: ${c.title}`];
  if (c.description && c.description !== c.title) {
    objs.push(c.description.slice(0, 200));
  }
  return objs;
}
