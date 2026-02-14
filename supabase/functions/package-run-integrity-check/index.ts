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

// ── Simple hash for near-duplicate detection ─────────────────────────
function normalizeText(t: string): string {
  return (t || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, " ").replace(/\s+/g, " ").trim();
}
function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function trigramSet(s: string): Set<string> {
  const t = new Set<string>();
  const n = normalizeText(s);
  for (let i = 0; i <= n.length - 3; i++) t.add(n.slice(i, i + 3));
  return t;
}
function trigramSimilarity(a: string, b: string): number {
  const sa = trigramSet(a), sb = trigramSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.max(sa.size, sb.size, 1);
}

// ── Stratified sampling helpers ──────────────────────────────────────
function stratifiedSample<T>(items: T[], groupFn: (i: T) => string, quotas: Record<string, number>, total: number): T[] {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = groupFn(item);
    (groups[key] ||= []).push(item);
  }
  // Shuffle each group
  for (const k in groups) groups[k].sort(() => Math.random() - 0.5);

  const result: T[] = [];
  const used = new Set<number>();

  // Fulfill quotas first
  for (const [key, min] of Object.entries(quotas)) {
    const pool = groups[key] || [];
    for (let i = 0; i < Math.min(min, pool.length); i++) {
      const idx = items.indexOf(pool[i]);
      if (!used.has(idx)) { result.push(pool[i]); used.add(idx); }
    }
  }

  // Fill remaining to reach total
  const remaining = items.filter((_, i) => !used.has(i)).sort(() => Math.random() - 0.5);
  for (const item of remaining) {
    if (result.length >= total) break;
    result.push(item);
  }
  return result;
}

// ── Near-duplicate clustering ────────────────────────────────────────
interface DupCluster { cluster_id: number; items: { id: string; text: string; similarity: number }[] }
function findNearDuplicates(questions: { id: string; question_text: string }[], threshold = 0.75, maxClusters = 30): { clusters: DupCluster[]; rate: number } {
  const clusters: DupCluster[] = [];
  const assigned = new Set<string>();
  const sorted = [...questions].sort((a, b) => (a.question_text || "").length - (b.question_text || "").length);

  for (let i = 0; i < sorted.length && clusters.length < maxClusters * 2; i++) {
    if (assigned.has(sorted[i].id)) continue;
    const cluster: DupCluster = { cluster_id: clusters.length, items: [{ id: sorted[i].id, text: sorted[i].question_text, similarity: 1 }] };
    for (let j = i + 1; j < sorted.length && cluster.items.length < 5; j++) {
      if (assigned.has(sorted[j].id)) continue;
      // Quick length check
      const lenA = normalizeText(sorted[i].question_text).length;
      const lenB = normalizeText(sorted[j].question_text).length;
      if (Math.abs(lenA - lenB) > Math.max(lenA, lenB) * 0.4) continue;

      const sim = trigramSimilarity(sorted[i].question_text, sorted[j].question_text);
      if (sim >= threshold) {
        cluster.items.push({ id: sorted[j].id, text: sorted[j].question_text, similarity: Math.round(sim * 100) / 100 });
        assigned.add(sorted[j].id);
      }
    }
    if (cluster.items.length > 1) {
      assigned.add(sorted[i].id);
      clusters.push(cluster);
    }
  }

  const dupCount = clusters.reduce((s, c) => s + c.items.length - 1, 0);
  return { clusters: clusters.slice(0, maxClusters), rate: questions.length > 0 ? Math.round(dupCount / questions.length * 10000) / 100 : 0 };
}

// ── Low-confidence heuristic ─────────────────────────────────────────
interface LowConfItem { id: string; question_text: string; reasons: string[] }
function findLowConfidence(questions: { id: string; question_text: string; options: any[] }[], max = 20): LowConfItem[] {
  const flagged: LowConfItem[] = [];
  for (const q of questions) {
    if (flagged.length >= max) break;
    const reasons: string[] = [];
    const text = (q.question_text || "").trim();
    if (text.length < 20) reasons.push("very_short_question");
    if (text.length > 800) reasons.push("very_long_question");
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 3) reasons.push("too_few_options");
    // Check for very similar options
    const optTexts = opts.map((o: any) => normalizeText(typeof o === "string" ? o : o.text || ""));
    for (let i = 0; i < optTexts.length; i++) {
      for (let j = i + 1; j < optTexts.length; j++) {
        if (optTexts[i] && optTexts[j] && trigramSimilarity(optTexts[i], optTexts[j]) > 0.85) {
          reasons.push("very_similar_options");
          break;
        }
      }
      if (reasons.includes("very_similar_options")) break;
    }
    if (reasons.length > 0) flagged.push({ id: q.id, question_text: text, reasons });
  }
  return flagged;
}

// ── Sanitize question (remove correct answer markers) ────────────────
function sanitizeQuestion(q: any) {
  return {
    id: q.id,
    question_text: q.question_text,
    options: Array.isArray(q.options) ? (q.options as any[]).map((o: any) => ({ text: o.text || o })) : [],
    difficulty: q.difficulty,
    bloom_level: q.bloom_level,
    topic_id: q.topic_id,
    learning_field_id: q.learning_field_id,
    blueprint_id: q.blueprint_id,
  };
}

// ── Build enhanced export JSON with sampling_plan ────────────────────
async function buildExportJson(sb: ReturnType<typeof createClient>, packageId: string, courseId: string, curriculumId: string, report: Record<string, unknown>) {
  // Package metadata
  const { data: pkg } = await sb.from("course_packages").select("id, course_id, title, status, created_at, build_progress").eq("id", packageId).single();
  const { data: course } = await sb.from("courses").select("id, slug, curriculum_id, status").eq("id", courseId).single();
  const { data: steps } = await sb.from("course_package_build_steps").select("step_key, status").eq("package_id", packageId).order("sort_order");

  // Curriculum
  const { data: curriculum } = await sb.from("curricula").select("id, certification_id, title").eq("id", curriculumId).single();
  const { data: topics } = await sb.from("curriculum_topics").select("id, learning_field_id, title, weight").eq("curriculum_id", curriculumId);
  const { data: lfs } = await sb.from("curriculum_learning_fields").select("id, title, weight").eq("curriculum_id", curriculumId);

  // Lessons + MiniChecks
  const { data: modules } = await sb.from("course_modules").select("id, title, learning_field_id").eq("course_id", courseId);
  const moduleIds = (modules || []).map(m => m.id);
  let allLessons: any[] = [];
  if (moduleIds.length > 0) {
    const { data } = await sb.from("lessons").select("id, title, module_id, lesson_type, competency_id").in("module_id", moduleIds);
    allLessons = data || [];
  }
  // MiniCheck sampling: 30% of lessons, min 12 lessons OR min 25 minichecks
  const lessonCount = allLessons.length;
  const minicheckLessonsTarget = Math.max(12, Math.ceil(lessonCount * 0.3));
  const shuffledLessons = [...allLessons].sort(() => Math.random() - 0.5);
  const minicheckSample = shuffledLessons.slice(0, Math.min(minicheckLessonsTarget, lessonCount)).map(l => ({
    id: l.id, title: l.title, module_id: l.module_id, lesson_type: l.lesson_type,
  }));

  // ── EXAM SAMPLING (stratified 120 questions) ──
  const { data: allExamQs } = await sb.from("exam_questions")
    .select("id, question_text, options, difficulty, bloom_level, topic_id, learning_field_id, blueprint_id")
    .eq("curriculum_id", curriculumId);
  const examQuestions = allExamQs || [];
  const { count: examTotal } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);

  // Build difficulty quotas
  const diffQuota: Record<string, number> = { easy: 40, medium: 50, hard: 30 };
  // Build LF quotas (min 5 per LF)
  const lfIds = new Set((lfs || []).map(l => l.id));
  const lfQuotas: Record<string, number> = {};
  for (const lfId of lfIds) lfQuotas[lfId] = 5;

  // Step 1: stratify by difficulty
  const diffGroups: Record<string, any[]> = { easy: [], medium: [], hard: [] };
  for (const q of examQuestions) {
    const d = (q.difficulty || "medium").toLowerCase();
    (diffGroups[d] || (diffGroups["medium"] = diffGroups["medium"] || [])).push(q);
  }
  for (const k in diffGroups) diffGroups[k].sort(() => Math.random() - 0.5);

  const examSample: any[] = [];
  const usedIds = new Set<string>();

  // Fill difficulty quotas
  for (const [diff, quota] of Object.entries(diffQuota)) {
    const pool = diffGroups[diff] || [];
    for (const q of pool) {
      if (examSample.length >= 120) break;
      if (usedIds.has(q.id)) continue;
      if (examSample.filter(s => s.difficulty === diff).length >= quota) break;
      examSample.push(q);
      usedIds.add(q.id);
    }
  }

  // Ensure min 5 per learning_field
  for (const lfId of lfIds) {
    const currentCount = examSample.filter(q => q.learning_field_id === lfId).length;
    if (currentCount < 5) {
      const pool = examQuestions.filter(q => q.learning_field_id === lfId && !usedIds.has(q.id));
      pool.sort(() => Math.random() - 0.5);
      for (const q of pool) {
        if (examSample.filter(s => s.learning_field_id === lfId).length >= 5) break;
        if (examSample.length >= 120) break;
        examSample.push(q);
        usedIds.add(q.id);
      }
    }
  }

  // Fill remaining to 120
  const remaining = examQuestions.filter(q => !usedIds.has(q.id)).sort(() => Math.random() - 0.5);
  for (const q of remaining) {
    if (examSample.length >= 120) break;
    examSample.push(q);
  }

  // Coverage stats
  const blueprintIds = new Set(examQuestions.map(q => q.blueprint_id).filter(Boolean));
  const coveredBlueprints = new Set(examQuestions.filter(q => q.blueprint_id).map(q => q.blueprint_id));
  const { count: totalBlueprints } = await sb.from("question_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId).eq("status", "approved");
  const blueprintCoverage = (totalBlueprints || 0) > 0 ? Math.round(coveredBlueprints.size / (totalBlueprints || 1) * 100) : 0;

  // LF coverage
  const lfCoverage: Record<string, { covered: number; total: number; pct: number }> = {};
  for (const lf of (lfs || [])) {
    const topicsInLf = (topics || []).filter(t => t.learning_field_id === lf.id);
    const lfQs = examQuestions.filter(q => q.learning_field_id === lf.id);
    const topicsCovered = new Set(lfQs.map(q => q.topic_id).filter(Boolean));
    lfCoverage[lf.title || lf.id] = {
      covered: topicsCovered.size,
      total: topicsInLf.length,
      pct: topicsInLf.length > 0 ? Math.round(topicsCovered.size / topicsInLf.length * 100) : 100,
    };
  }

  // Difficulty distribution
  const diffDist = { easy: 0, medium: 0, hard: 0 };
  for (const q of examQuestions) {
    const d = (q.difficulty || "medium").toLowerCase();
    if (d in diffDist) diffDist[d as keyof typeof diffDist]++;
  }

  // Near-duplicate detection
  const dupResult = findNearDuplicates(examQuestions, 0.75, 30);

  // Low-confidence detection
  const lowConf = findLowConfidence(examQuestions as any, 20);

  // ── ORAL SAMPLING ──
  const { data: allOral } = await sb.from("oral_exam_scenarios").select("id, title, situation_description, rubric_criteria, learning_field_id, blueprint_id").eq("curriculum_id", curriculumId);
  const oralAll = allOral || [];
  const { count: oralTotal } = await sb.from("oral_exam_scenarios").select("id", { count: "exact", head: true }).eq("curriculum_id", curriculumId);
  const oralTarget = Math.max(15, Math.min(25, Math.ceil((oralTotal || 0) * 0.3)));
  const oralSample = [...oralAll].sort(() => Math.random() - 0.5).slice(0, oralTarget).map(o => ({
    id: o.id, title: o.title, situation_description: o.situation_description,
    learning_field_id: o.learning_field_id, blueprint_id: o.blueprint_id,
  }));

  // ── HANDBOOK SAMPLING (5 top-weight, 3 risk, 2 random) ──
  const { data: hbChapters } = await sb.from("handbook_chapters").select("id, title, sort_order").eq("course_id", courseId).order("sort_order");
  const { data: hbSections } = await sb.from("handbook_sections").select("id, title, chapter_id, content").eq("course_id", courseId);
  const allSections = hbSections || [];

  // Sort by weight (proxy: sort_order of chapter)
  const chapterOrder: Record<string, number> = {};
  for (const ch of (hbChapters || [])) chapterOrder[ch.id] = ch.sort_order || 0;
  const sectionsSorted = [...allSections].sort((a, b) => (chapterOrder[a.chapter_id] || 0) - (chapterOrder[b.chapter_id] || 0));
  const topWeight = sectionsSorted.slice(0, 5).map(s => ({ id: s.id, title: s.title, chapter_id: s.chapter_id }));
  // Risk: shortest content (possibly thin)
  const byLength = [...allSections].sort((a, b) => ((a.content || "").length) - ((b.content || "").length));
  const risk = byLength.slice(0, 3).map(s => ({ id: s.id, title: s.title, chapter_id: s.chapter_id, content_length: (s.content || "").length }));
  // Random 2
  const usedSectionIds = new Set([...topWeight, ...risk].map(s => s.id));
  const randomPool = allSections.filter(s => !usedSectionIds.has(s.id)).sort(() => Math.random() - 0.5);
  const randomSections = randomPool.slice(0, 2).map(s => ({ id: s.id, title: s.title, chapter_id: s.chapter_id }));

  // AI Tutor index
  const { data: tutorIdx } = await sb.from("ai_tutor_context_index").select("id, index_version, created_at, stats").eq("package_id", packageId).order("created_at", { ascending: false }).limit(1).maybeSingle();

  return {
    _meta: { generated_at: new Date().toISOString(), version: "2.0", purpose: "High-Assurance ChatGPT review export" },
    package: {
      id: pkg?.id, course_id: pkg?.course_id, title: pkg?.title,
      status: pkg?.status, created_at: pkg?.created_at,
      completed_steps: (steps || []).filter(s => s.status === "done").map(s => s.step_key),
      all_steps: (steps || []).map(s => ({ key: s.step_key, status: s.status })),
    },
    curriculum: {
      id: curriculum?.id, certification_id: curriculum?.certification_id, title: curriculum?.title,
      topic_count: (topics || []).length,
      learning_fields: (lfs || []).map(lf => ({ id: lf.id, title: lf.title, weight: lf.weight })),
      learning_field_coverage: lfCoverage,
    },
    lessons: {
      module_count: moduleIds.length,
      lesson_count: lessonCount,
    },
    exam: {
      target: 1000,
      generated_count: examTotal || 0,
      blueprint_coverage_pct: blueprintCoverage,
      difficulty_distribution: diffDist,
      near_duplicate_rate_pct: dupResult.rate,
      learning_field_coverage: lfCoverage,
    },
    oral: { scenario_count: oralTotal || 0 },
    tutor: {
      index_exists: !!tutorIdx, index_version: tutorIdx?.index_version,
      last_built_at: tutorIdx?.created_at, stats: tutorIdx?.stats,
    },
    handbook: {
      chapter_count: (hbChapters || []).length,
      section_count: allSections.length,
    },
    integrity: {
      passed: report?.passed, score: report?.score,
      warnings: report?.warnings, issues: report?.issues,
    },
    sampling_plan: {
      exam_sample: {
        total_sampled: examSample.length,
        difficulty_quota: diffQuota,
        actual_difficulty: {
          easy: examSample.filter(q => q.difficulty === "easy").length,
          medium: examSample.filter(q => q.difficulty === "medium").length,
          hard: examSample.filter(q => q.difficulty === "hard").length,
        },
        items: examSample.map(sanitizeQuestion),
      },
      minicheck_sample: {
        total_lessons_sampled: minicheckSample.length,
        target: minicheckLessonsTarget,
        items: minicheckSample,
      },
      oral_sample: {
        total_sampled: oralSample.length,
        target: oralTarget,
        items: oralSample,
      },
      handbook_sample: {
        top_weight: topWeight,
        risk_topics: risk,
        random: randomSections,
      },
      risk_sets: {
        near_duplicates_sample: {
          total_clusters: dupResult.clusters.length,
          duplicate_rate_pct: dupResult.rate,
          clusters: dupResult.clusters.map(c => ({
            cluster_id: c.cluster_id,
            items: c.items.map(i => ({ id: i.id, text: i.text.slice(0, 120), similarity: i.similarity })),
          })),
        },
        low_confidence_sample: {
          total_flagged: lowConf.length,
          items: lowConf.map(i => ({ id: i.id, question_text: i.question_text.slice(0, 150), reasons: i.reasons })),
        },
      },
    },
    links: {
      admin_workspace_url: `/admin/studio/${packageId}`,
      course_public_url: course?.slug ? `/course/${course.slug}` : null,
    },
  };
}

// ── Integrity Check v3 ───────────────────────────────────────────────
interface V3Result {
  passed: boolean;
  score: number;
  hard_fail_reasons: string[];
  warnings: string[];
  coverage: {
    blueprint_pct: number;
    learning_field_coverage: Record<string, number>;
    near_duplicate_rate_pct: number;
  };
  v2_report: Record<string, unknown>;
}

async function validateIntegrityV3(sb: ReturnType<typeof createClient>, curriculumId: string, v2Report: Record<string, unknown>): Promise<V3Result> {
  const hardFails: string[] = [];
  const warnings: string[] = [];

  // Get exam questions for coverage checks
  const { data: examQs } = await sb.from("exam_questions")
    .select("id, question_text, options, topic_id, learning_field_id, blueprint_id, difficulty")
    .eq("curriculum_id", curriculumId);
  const questions = examQs || [];

  // Blueprint coverage
  const { count: totalBlueprints } = await sb.from("question_blueprints")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId).eq("status", "approved");
  const coveredBPs = new Set(questions.map(q => q.blueprint_id).filter(Boolean));
  const bpCoverage = (totalBlueprints || 0) > 0 ? Math.round(coveredBPs.size / (totalBlueprints || 1) * 100) : 100;
  if (bpCoverage < 95) hardFails.push(`blueprint_coverage ${bpCoverage}% < 95% required`);
  else if (bpCoverage < 100) warnings.push(`blueprint_coverage ${bpCoverage}% (target 100%)`);

  // Learning field coverage (>= 90% per field)
  const { data: lfs } = await sb.from("curriculum_learning_fields").select("id, title").eq("curriculum_id", curriculumId);
  const { data: topics } = await sb.from("curriculum_topics").select("id, learning_field_id").eq("curriculum_id", curriculumId);
  const lfCov: Record<string, number> = {};
  for (const lf of (lfs || [])) {
    const topicsInLf = (topics || []).filter(t => t.learning_field_id === lf.id);
    const qsInLf = questions.filter(q => q.learning_field_id === lf.id);
    const topicsCovered = new Set(qsInLf.map(q => q.topic_id).filter(Boolean));
    const pct = topicsInLf.length > 0 ? Math.round(topicsCovered.size / topicsInLf.length * 100) : 100;
    lfCov[lf.title || lf.id] = pct;
    if (pct < 90) hardFails.push(`learning_field "${lf.title}" coverage ${pct}% < 90% required`);
    else if (pct < 100) warnings.push(`learning_field "${lf.title}" coverage ${pct}%`);
  }

  // Near-duplicate rate <= 3%
  const dupResult = findNearDuplicates(questions, 0.75, 50);
  if (dupResult.rate > 3) hardFails.push(`near_duplicate_rate ${dupResult.rate}% > 3% allowed`);
  else if (dupResult.rate > 1.5) warnings.push(`near_duplicate_rate ${dupResult.rate}% (watch)`);

  // Low-confidence structural check
  const lowConf = findLowConfidence(questions as any, 100);
  const structuralBad = lowConf.filter(i => i.reasons.includes("too_few_options") || i.reasons.includes("very_short_question"));
  const badRate = questions.length > 0 ? structuralBad.length / questions.length * 100 : 0;
  if (badRate > 1) hardFails.push(`structural_bad_questions ${badRate.toFixed(1)}% > 1% (${structuralBad.length} items)`);
  else if (structuralBad.length > 0) warnings.push(`${structuralBad.length} structurally weak questions detected`);

  // Combine with v2 score
  const v2Score = Number(v2Report?.score ?? 0);
    // V3 deductions
    let v3Deduction = 0;
    if (hardFails.length > 0) v3Deduction += hardFails.length * 5;
    if (warnings.length > 0) v3Deduction += warnings.length * 1;
    const finalScore = Math.max(0, Math.min(100, v2Score - v3Deduction));
    // Ship-Ready Gate: dynamic based on exam target from package options
    const examTarget = Number(options?.exam_target ?? 1000);
    const shipTarget = examTarget <= 600 ? 500 : examTarget <= 800 ? 700 : examTarget <= 1000 ? 850 : 1000;
    const questionCount = questions.length;
    const shipReady = questionCount >= shipTarget;
    const basePass = shipReady && hardFails.length === 0 && finalScore >= 60;
    const authorityPass = hardFails.length === 0 && finalScore >= 80;
    const passed = basePass || authorityPass;
    if (shipReady && !authorityPass && basePass) {
      warnings.push(`Ship-ready (${questionCount} questions, score ${finalScore}) but below Authority threshold (80)`);
    }

  return {
    passed,
    score: finalScore,
    hard_fail_reasons: hardFails,
    warnings,
    coverage: {
      blueprint_pct: bpCoverage,
      learning_field_coverage: lfCov,
      near_duplicate_rate_pct: dupResult.rate,
    },
    v2_report: v2Report,
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

  const packageId = p.package_id;
  const options = p.options || {};

  // Resolve course_id and curriculum_id from package
  let courseId = p.course_id;
  let curriculumId = p.curriculum_id;

  if (!courseId || !curriculumId) {
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages").select("course_id").eq("id", packageId).single();
    if (pkgErr || !pkg) return json({ error: "Package not found" }, 404);
    courseId = pkg.course_id;

    const { data: crs, error: crsErr } = await sb
      .from("courses").select("curriculum_id").eq("id", courseId).single();
    if (crsErr || !crs) return json({ error: "Course not found" }, 404);
    curriculumId = crs.curriculum_id;
  }

  const unlockFail = async (msg: string, report?: unknown) => {
    await sb.from("course_packages").update({
      status: "failed",
      integrity_passed: false,
      integrity_report: report || { error: msg },
    }).eq("id", packageId);
    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "failed",
      p_log: { error: msg, report },
    });
    await sb.rpc("release_pipeline_lock", { p_package_id: packageId });
    await sb.from("course_package_locks").delete().eq("package_id", packageId);
  };

  try {
    // Prereq: exam pool must be fully done (including fan-out sub-jobs)
    const examStepDone = await prereqDone(sb, packageId, "generate_exam_pool");
    if (!examStepDone) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_exam_pool" }, 409);
    }

    // Extra guard: check no pending/processing fan-out exam jobs remain
    const { count: pendingExamJobs } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("job_type", "package_generate_exam_pool")
      .in("status", ["pending", "processing"])
      .filter("payload->>package_id", "eq", packageId);
    if ((pendingExamJobs ?? 0) > 0) {
      return json({ ok: false, retry: true, error: `PREREQ_NOT_DONE: ${pendingExamJobs} exam fan-out jobs still running` }, 409);
    }

    // Prereq: handbook must be done
    if (!(await prereqDone(sb, packageId, "generate_handbook"))) {
      return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: generate_handbook" }, 409);
    }

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "running",
      p_log: { note: "Running validate_course_integrity_v3 (high-assurance)" },
    });

    // Run v2 first
    const { data, error } = await sb.rpc("validate_course_integrity_v2", {
      p_curriculum_id: curriculumId,
    });
    if (error) throw error;
    const v2Report = data as Record<string, unknown>;

    // Run v3 checks
    const v3Result = await validateIntegrityV3(sb, curriculumId, v2Report);

    const summary = {
      score: v3Result.score,
      passed: v3Result.passed,
      hard_fail_reasons: v3Result.hard_fail_reasons,
      warnings: v3Result.warnings,
      coverage: v3Result.coverage,
      exam_questions: `${(v2Report?.exam as any)?.total || 0}/${(v2Report?.exam as any)?.target || 1000}`,
      oral_scenarios: `${(v2Report?.oral as any)?.total || 0}/${(v2Report?.oral as any)?.target || 20}`,
      handbook_chapters: `${(v2Report?.handbook as any)?.chapters || 0}/${(v2Report?.handbook as any)?.target || 5}`,
    };

    const fullReport = { ...v2Report, v3: { hard_fail_reasons: v3Result.hard_fail_reasons, warnings: v3Result.warnings, coverage: v3Result.coverage, score: v3Result.score, passed: v3Result.passed } };

    if (!v3Result.passed) {
      // ── FAILED ──
      await unlockFail(`Integrity v3 Score ${v3Result.score}/100 – ${v3Result.hard_fail_reasons.length} hard fails`, fullReport);

      await sb.from("course_package_reviews").upsert({
        course_package_id: packageId,
        status: "queued",
        integrity_score: v3Result.score,
        integrity_report: fullReport,
        notes: `V3 hard fails: ${v3Result.hard_fail_reasons.join("; ")}`,
      }, { onConflict: "course_package_id" });

      await sb.from("admin_notifications").insert({
        title: `❌ Package blocked – Score ${v3Result.score}`,
        body: `${v3Result.hard_fail_reasons.length} hard fail(s): ${v3Result.hard_fail_reasons.slice(0, 2).join(", ")}`,
        category: "package_review",
        severity: "warn",
        entity_type: "course_package",
        entity_id: packageId,
      });

      // Auto-Gap-Closer Trigger
      const shouldAutoFix = options.auto_gap_close !== false;
      if (shouldAutoFix) {
        try {
          const { data: existingRun } = await sb.from("autofix_runs")
            .select("id").eq("package_id", packageId).eq("status", "running").maybeSingle();
          const { data: recentRun } = await sb.from("autofix_runs")
            .select("id").eq("package_id", packageId)
            .in("status", ["running", "succeeded", "stopped"])
            .gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          if (!existingRun && !recentRun && curriculumId) {
            await sb.from("job_queue").insert({
              job_type: "auto_gap_close", status: "pending",
              payload: { package_id: packageId, course_id: courseId, curriculum_id: curriculumId, target_score: options.autofix_target_score || 60, max_rounds: 3, budget_eur: 2.0, triggered_by: "integrity_v3_auto" },
              max_attempts: 1,
            });
          }
        } catch (autoErr) {
          console.error("[IntegrityV3] Auto-Gap-Closer trigger failed:", (autoErr as Error).message);
        }
      }

      return json({ ok: false, error: `Integrity v3 failed (score: ${v3Result.score})`, summary, auto_gap_close_triggered: shouldAutoFix }, 422);
    }

    // ── PASSED ──
    await sb.from("course_packages").update({
      integrity_passed: true,
      integrity_report: fullReport,
      status: "ready_for_review",
      build_progress: 95,
    }).eq("id", packageId);

    // Generate export JSON with sampling
    let exportJson: unknown = null;
    try {
      exportJson = await buildExportJson(sb, packageId, courseId, curriculumId, fullReport);
    } catch (expErr) {
      console.error("[IntegrityV3] Export JSON build failed (non-fatal):", (expErr as Error).message);
      exportJson = { error: "export_build_failed", message: (expErr as Error).message };
    }

    await sb.from("course_package_reviews").upsert({
      course_package_id: packageId,
      status: "ready",
      integrity_score: v3Result.score,
      integrity_report: fullReport,
      export_json: exportJson,
    }, { onConflict: "course_package_id" });

    await sb.from("admin_notifications").insert({
      title: `✅ Package ready – Score ${v3Result.score}`,
      body: `Integrity v3 passed. BP: ${v3Result.coverage.blueprint_pct}%, Dup: ${v3Result.coverage.near_duplicate_rate_pct}%. Review & approve.`,
      category: "package_review",
      severity: "info",
      entity_type: "course_package",
      entity_id: packageId,
    });

    await sb.rpc("update_course_package_step", {
      p_package_id: packageId, p_step_key: "run_integrity_check", p_status: "done",
      p_log: { ok: true, ...summary, review_status: "ready_for_review" },
    });

    return json({ ok: true, score: v3Result.score, summary, review_status: "ready_for_review" });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    await unlockFail(msg);
    return json({ ok: false, error: msg }, 500);
  }
});
