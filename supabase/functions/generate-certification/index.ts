import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyCertification } from "../_shared/certifications/classify-certification.ts";
import { selectBlueprintTypes } from "../_shared/certifications/select-blueprint-types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
          generator_version: "2026-04-04-v1",
          blueprint_types: blueprintTypes,
        },
      })
      .select("*")
      .single();

    if (certError) throw certError;

    // 2. Create curriculum — map to real DB enums
    const trackEnumMap: Record<string, string> = {
      FORTBILDUNG: "FORTBILDUNG",
      CERTIFICATION: "ZERTIFIKAT",
      AUSBILDUNG: "AUSBILDUNG_VOLL",
      STUDIUM: "STUDIUM",
    };
    const certTypeEnumMap: Record<string, string> = {
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

    const { data: curriculum, error: curriculumError } = await sb
      .from("curricula")
      .insert({
        title: `${title} – Curriculum`,
        certification_id: cert.id,
        status: "draft",
        track: trackEnumMap[classification.track] ?? "EXAM_FIRST",
        certification_type: certTypeEnumMap[classification.certificationType] ?? "sonstige",
        program_type: classification.track === "STUDIUM" ? "higher_education" : "vocational",
      })
      .select("id")
      .single();

    if (curriculumError) throw curriculumError;

    // 3. Create course_package (queued for pipeline)
    const { data: pkg, error: pkgError } = await sb
      .from("course_packages")
      .insert({
        curriculum_id: curriculum.id,
        certification_id: cert.id,
        track: trackEnumMap[classification.track] ?? "EXAM_FIRST",
        certification_type: certTypeEnumMap[classification.certificationType] ?? "sonstige",
        integrity_profile: classification.validationProfile,
        status: "queued",
        priority: body.priority ?? 5,
      })
      .select("id")
      .single();

    if (pkgError) throw pkgError;

    return new Response(
      JSON.stringify({
        ok: true,
        certification_id: cert.id,
        curriculum_id: curriculum.id,
        package_id: pkg.id,
        classification,
        blueprint_types: blueprintTypes,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("generate-certification error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error?.message ?? error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
