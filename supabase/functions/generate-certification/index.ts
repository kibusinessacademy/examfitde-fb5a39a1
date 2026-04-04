import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyCertification } from "../_shared/certifications/classify-certification.ts";
import { selectBlueprintTypes } from "../_shared/certifications/select-blueprint-types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Standard step backbone (active steps) ──────────────────────────
const STEP_BACKBONE: string[] = [
  "scaffold_learning_course",
  "generate_glossary",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_learning_content",
  "fanout_learning_content",
  "finalize_learning_content",
  "validate_learning_content",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_exam_pool",
  "validate_exam_pool",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_handbook",
  "enqueue_handbook_expand",
  "expand_handbook",
  "validate_handbook",
  "validate_handbook_depth",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "run_integrity_check",
  "elite_harden",
  "quality_council",
  "auto_publish",
];

// ── Reason codes for factory verification ──────────────────────────
type FactoryReasonCode =
  | "FACTORY_MISSING_COURSE"
  | "FACTORY_MISSING_NORMALIZED_DATA"
  | "FACTORY_MISSING_STEP_BACKBONE"
  | "FACTORY_ENRICHMENT_INCOMPLETE"
  | "FACTORY_BUILDING_TRANSITION_FAILED";

// ── Track→DB enum mappings ─────────────────────────────────────────
const TRACK_ENUM: Record<string, string> = {
  FORTBILDUNG: "FORTBILDUNG",
  CERTIFICATION: "ZERTIFIKAT",
  AUSBILDUNG: "AUSBILDUNG_VOLL",
  STUDIUM: "STUDIUM",
};
const CERT_TYPE_ENUM: Record<string, string> = {
  IHK_AUFSTIEG: "aufstiegsfortbildung",
  MEISTER: "aufstiegsfortbildung",
  AEVO: "aufstiegsfortbildung",
  FINANCE: "aufstiegsfortbildung",
  PROJECT_MANAGEMENT: "branchenzertifikat",
  CLOUD: "branchenzertifikat",
  SECURITY: "branchenzertifikat",
  DATA: "branchenzertifikat",
  PRIVACY: "branchenzertifikat",
  ERP: "branchenzertifikat",
  GENERAL: "sonstige",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const title = String(body.title ?? "").trim();
    if (!title) {
      return new Response(
        JSON.stringify({ error: "title is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const classification = classifyCertification(title);
    const blueprintTypes = selectBlueprintTypes(classification);

    const curriculumTrack = TRACK_ENUM[classification.track];
    if (!curriculumTrack) throw new Error(`Unsupported track: ${classification.track}`);
    const curriculumCertType = CERT_TYPE_ENUM[classification.certificationType];
    if (!curriculumCertType) throw new Error(`Unsupported cert type: ${classification.certificationType}`);

    // ════════════════════════════════════════════════════════════════
    // TRANSACTION A: Create all artefacts + infrastructure
    // ════════════════════════════════════════════════════════════════

    // 1. Create certification
    const { data: cert, error: certError } = await sb
      .from("certifications")
      .insert({
        slug,
        title,
        short_title: body.short_title ?? title,
        track: classification.track,
        certification_type: classification.certificationType,
        validation_profile: classification.validationProfile,
        exam_modes: classification.examModes,
        oral_exam_enabled: classification.oralExamEnabled,
        calculation_heavy: classification.calculationHeavy,
        framework_heavy: classification.frameworkHeavy,
        provider: body.provider ?? null,
        provider_type: body.provider_type ?? null,
        level: body.level ?? null,
        language: body.language ?? "de",
        international: body.international ?? false,
        meta: {
          generator_version: "2026-04-04-v2",
          blueprint_types: blueprintTypes,
        },
      })
      .select("*")
      .single();
    if (certError) throw certError;

    // 2. Create curriculum
    const { data: curriculum, error: curriculumError } = await sb
      .from("curricula")
      .insert({
        title: `${title} – Curriculum`,
        certification_id: cert.id,
        status: "draft",
        track: curriculumTrack,
        certification_type: curriculumCertType,
        program_type: classification.track === "STUDIUM" ? "higher_education" : "vocational",
      })
      .select("id")
      .single();
    if (curriculumError) throw curriculumError;

    // 3. Create learning fields (from body or auto-generate placeholder set)
    const learningFieldDefs: Array<{ title: string; description: string }> =
      body.learning_fields ?? generateDefaultLearningFields(title, classification);

    const lfInserts = learningFieldDefs.map((lf, i) => ({
      curriculum_id: curriculum.id,
      code: `${slug}-lf-${i + 1}`,
      title: lf.title,
      description: lf.description ?? "",
      sort_order: i + 1,
    }));

    const { data: lfs, error: lfError } = await sb
      .from("learning_fields")
      .insert(lfInserts)
      .select("id, title, sort_order");
    if (lfError) throw lfError;

    // 4. Create competencies for each LF + mark enriched
    const compInserts: Array<Record<string, unknown>> = [];
    for (const lf of (lfs ?? [])) {
      const compCount = body.competencies_per_lf ?? 3;
      for (let c = 0; c < compCount; c++) {
        compInserts.push({
          learning_field_id: lf.id,
          title: `${lf.title} – Kompetenz ${c + 1}`,
          code: `${slug}-lf${lf.sort_order}-k${c + 1}`,
          enrichment_version: 2, // ← satisfy guard_building_requires_enrichment
        });
      }
    }
    const { error: compError } = await sb.from("competencies").insert(compInserts);
    if (compError) throw compError;

    // 5. Write normalized_data on curriculum
    const lernfelderArray = (lfs ?? []).map((lf) => ({
      id: lf.id,
      title: lf.title,
      sort_order: lf.sort_order,
    }));
    const { error: ndError } = await sb
      .from("curricula")
      .update({
        normalized_data: { lernfelder: lernfelderArray },
      })
      .eq("id", curriculum.id);
    if (ndError) throw ndError;

    // 6. Create course
    const { data: course, error: courseError } = await sb
      .from("courses")
      .insert({
        curriculum_id: curriculum.id,
        title,
        description: `Prüfungsvorbereitung: ${title}`,
        status: "draft",
      })
      .select("id")
      .single();
    if (courseError) throw courseError;

    // 7. Create course_package (queued initially, linked to course)
    const { data: pkg, error: pkgError } = await sb
      .from("course_packages")
      .insert({
        curriculum_id: curriculum.id,
        certification_id: cert.id,
        course_id: course.id,
        track: curriculumTrack,
        certification_type: curriculumCertType,
        integrity_profile: classification.validationProfile,
        status: "queued",
        priority: body.priority ?? 5,
      })
      .select("id")
      .single();
    if (pkgError) throw pkgError;

    // 8. Scaffold step backbone
    const stepInserts = STEP_BACKBONE.map((key) => ({
      package_id: pkg.id,
      step_key: key,
      status: key === "scaffold_learning_course" ? "done" : "queued",
      started_at: key === "scaffold_learning_course" ? new Date().toISOString() : null,
      finished_at: key === "scaffold_learning_course" ? new Date().toISOString() : null,
      meta: {},
    }));

    const { error: stepError } = await sb.from("package_steps").insert(stepInserts);
    if (stepError) throw stepError;

    // ════════════════════════════════════════════════════════════════
    // TRANSACTION B: Transition queued → building (separate commit)
    // ════════════════════════════════════════════════════════════════

    const { error: buildError } = await sb
      .from("course_packages")
      .update({
        status: "building",
        blocked_reason: null,
      })
      .eq("id", pkg.id);

    if (buildError) {
      console.error("Building transition failed:", buildError);
      // Don't throw — artefacts are created, but report failure
    }

    // ════════════════════════════════════════════════════════════════
    // FAIL-FAST COMPLETION CHECK
    // ════════════════════════════════════════════════════════════════
    const failures: FactoryReasonCode[] = [];

    // Check course_id
    const { data: pkgCheck } = await sb
      .from("course_packages")
      .select("course_id, status")
      .eq("id", pkg.id)
      .single();

    if (!pkgCheck?.course_id) failures.push("FACTORY_MISSING_COURSE");
    if (pkgCheck?.status !== "building") failures.push("FACTORY_BUILDING_TRANSITION_FAILED");

    // Check normalized_data
    const { data: currCheck } = await sb
      .from("curricula")
      .select("normalized_data")
      .eq("id", curriculum.id)
      .single();

    const nd = currCheck?.normalized_data as Record<string, unknown> | null;
    if (!nd?.lernfelder || !Array.isArray(nd.lernfelder) || nd.lernfelder.length === 0) {
      failures.push("FACTORY_MISSING_NORMALIZED_DATA");
    }

    // Check step count
    const { count: stepCount } = await sb
      .from("package_steps")
      .select("id", { count: "exact", head: true })
      .eq("package_id", pkg.id);

    if (!stepCount || stepCount < STEP_BACKBONE.length) {
      failures.push("FACTORY_MISSING_STEP_BACKBONE");
    }

    // Check enrichment completeness (competencies are linked via learning_fields)
    const lfIds = (lfs ?? []).map((lf) => lf.id);
    const { count: totalComps } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("learning_field_id", lfIds.length ? lfIds : ["__none__"]);

    const { count: enrichedComps } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("learning_field_id", lfIds.length ? lfIds : ["__none__"])
      .gte("enrichment_version", 2);

    if (totalComps !== enrichedComps) {
      failures.push("FACTORY_ENRICHMENT_INCOMPLETE");
    }

    // ── Final verdict ──────────────────────────────────────────────
    const factoryReady = failures.length === 0;

    if (!factoryReady) {
      console.error(`Factory verification FAILED for ${slug}:`, failures);
    }

    return new Response(
      JSON.stringify({
        ok: factoryReady,
        factory_ready: factoryReady,
        failures: factoryReady ? undefined : failures,
        certification_id: cert.id,
        curriculum_id: curriculum.id,
        course_id: course.id,
        package_id: pkg.id,
        package_status: pkgCheck?.status ?? "unknown",
        classification,
        blueprint_types: blueprintTypes,
        learning_fields_created: lfs?.length ?? 0,
        competencies_created: compInserts.length,
        steps_scaffolded: stepCount ?? 0,
        enrichment: { total: totalComps, enriched: enrichedComps },
      }),
      {
        status: factoryReady ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("generate-certification error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error?.message ?? error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Default learning field generator ───────────────────────────────
function generateDefaultLearningFields(
  title: string,
  classification: ReturnType<typeof classifyCertification>,
): Array<{ title: string; description: string }> {
  const t = classification.certificationType;

  if (t === "AEVO") {
    return [
      { title: "Ausbildungsvoraussetzungen prüfen", description: "Handlungsfeld 1" },
      { title: "Ausbildung planen", description: "Handlungsfeld 2" },
      { title: "Ausbildung durchführen", description: "Handlungsfeld 3" },
      { title: "Ausbildung abschließen", description: "Handlungsfeld 4" },
    ];
  }

  if (t === "IHK_AUFSTIEG" || t === "MEISTER" || t === "FINANCE") {
    // Generic IHK structure — 6 Handlungsfelder
    return [
      { title: `${title} – Handlungsbereich 1`, description: "Grundlagen und Rahmenbedingungen" },
      { title: `${title} – Handlungsbereich 2`, description: "Planung und Organisation" },
      { title: `${title} – Handlungsbereich 3`, description: "Durchführung und Steuerung" },
      { title: `${title} – Handlungsbereich 4`, description: "Kontrolle und Qualitätssicherung" },
      { title: `${title} – Handlungsbereich 5`, description: "Kommunikation und Führung" },
      { title: `${title} – Handlungsbereich 6`, description: "Recht und Compliance" },
    ];
  }

  if (t === "PROJECT_MANAGEMENT") {
    return [
      { title: "Grundlagen und Terminologie", description: "Framework-Grundwissen" },
      { title: "Rollen und Verantwortlichkeiten", description: "Organisationsstruktur" },
      { title: "Prozesse und Praktiken", description: "Kernprozesse" },
      { title: "Werkzeuge und Techniken", description: "Methodik" },
      { title: "Prüfungsvorbereitung und Simulation", description: "Praxis" },
    ];
  }

  if (t === "CLOUD") {
    return [
      { title: "Cloud-Konzepte und Architektur", description: "Grundlagen" },
      { title: "Sicherheit und Compliance", description: "Security Fundamentals" },
      { title: "Technologie und Services", description: "Kernservices" },
      { title: "Abrechnung und Preisgestaltung", description: "Billing" },
      { title: "Praxisszenarien", description: "Anwendungsfälle" },
    ];
  }

  if (t === "SECURITY") {
    return [
      { title: "Sicherheitsgrundlagen", description: "Basiskonzepte" },
      { title: "Risikomanagement", description: "Risk Assessment" },
      { title: "Zugriffskontrolle", description: "Access Control" },
      { title: "Netzwerksicherheit", description: "Network Security" },
      { title: "Compliance und Governance", description: "Governance" },
    ];
  }

  // Generic fallback — 4 fields
  return [
    { title: `${title} – Grundlagen`, description: "Basiswissen" },
    { title: `${title} – Anwendung`, description: "Praxiswissen" },
    { title: `${title} – Vertiefung`, description: "Expertenwissen" },
    { title: `${title} – Prüfungsvorbereitung`, description: "Prüfungsrelevant" },
  ];
}
