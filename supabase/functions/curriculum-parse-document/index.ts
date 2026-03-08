import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

function parseKmkPdf(text: string) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const learningFields = lines
    .filter((l) => /^Lernfeld\s+\d+/i.test(l))
    .map((l) => ({ title: l }));

  return {
    title_normalized: lines[0] || "Unbekanntes KMK-Curriculum",
    education_type: "dual_ausbildung",
    award_type: "ausbildungsberuf",
    source_authority: "KMK",
    learning_fields: learningFields,
    competency_areas: [] as unknown[],
    source_confidence: learningFields.length >= 8 ? 90 : 65,
    parsed_payload: { raw_lines_sample: lines.slice(0, 50) },
  };
}

function parseIhkMeta(text: string) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const examHints = lines.filter((l) =>
    /schriftlich|mündlich|projekt|präsentation|prüfungsteil/i.test(l)
  );

  return {
    title_normalized: lines[0] || "Unbekannte IHK-Fortbildung",
    education_type: "ihk_fortbildung",
    award_type: /fachwirt/i.test(text)
      ? "fachwirt"
      : /betriebswirt/i.test(text)
      ? "betriebswirt"
      : /meister/i.test(text)
      ? "meister"
      : "fortbildung",
    source_authority: "IHK",
    learning_fields: [] as unknown[],
    competency_areas: examHints.slice(0, 20).map((x) => ({ title: x })),
    source_confidence: examHints.length > 3 ? 80 : 60,
    parsed_payload: { exam_hints: examHints.slice(0, 50) },
  };
}

function parseHwkMeta(text: string) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const competencyAreas = lines.filter((l) =>
    /teil i|teil ii|teil iii|teil iv|meister|prüfung|zulassung/i.test(l)
  );

  return {
    title_normalized: lines[0] || "Unbekannte HWK-Fortbildung",
    education_type: "hwk_fortbildung",
    award_type: /meister/i.test(text) ? "meister" : "fortbildung",
    source_authority: "HWK",
    learning_fields: [] as unknown[],
    competency_areas: competencyAreas.slice(0, 20).map((x) => ({ title: x })),
    source_confidence: competencyAreas.length > 3 ? 78 : 58,
    parsed_payload: { competency_areas: competencyAreas.slice(0, 50) },
  };
}

function parseBibbDirectory(text: string) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const learningFields = lines
    .filter((l) => /lernfeld|ausbildungsrahmenplan|berufsbildposition/i.test(l))
    .map((l) => ({ title: l }));

  return {
    title_normalized: lines[0] || "Unbekannter BIBB-Eintrag",
    education_type: "dual_ausbildung",
    award_type: "ausbildungsberuf",
    source_authority: "BIBB",
    learning_fields: learningFields,
    competency_areas: [] as unknown[],
    source_confidence: learningFields.length >= 5 ? 85 : 60,
    parsed_payload: { raw_lines_sample: lines.slice(0, 50) },
  };
}

function parseGenericCertification(text: string) {
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const areas = lines
    .filter((l) => /modul|kompetenz|prüfung|zertifik/i.test(l))
    .map((l) => ({ title: l }));

  return {
    title_normalized: lines[0] || "Unbekannte Zertifizierung",
    education_type: "certification",
    award_type: "sonstige",
    source_authority: null,
    learning_fields: [] as unknown[],
    competency_areas: areas.slice(0, 20),
    source_confidence: areas.length > 3 ? 70 : 45,
    parsed_payload: { areas: areas.slice(0, 50) },
  };
}

function selectParser(strategy: string) {
  switch (strategy) {
    case "kmk_pdf": return parseKmkPdf;
    case "bibb_directory": return parseBibbDirectory;
    case "ihk_exam_meta": return parseIhkMeta;
    case "hwk_exam_meta": return parseHwkMeta;
    case "generic_certification": return parseGenericCertification;
    default: return parseGenericCertification;
  }
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const body = await req.json().catch(() => ({}));
  const documentId = body.document_id as string | undefined;

  if (!documentId) return json(400, { ok: false, error: "document_id required" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: doc } = await sb
    .from("curriculum_source_documents")
    .select("*, curriculum_intake_candidates(*)")
    .eq("id", documentId)
    .single();

  if (!doc) return json(404, { ok: false, error: "document not found" }, origin);

  const candidate = (doc as any).curriculum_intake_candidates;
  if (!candidate) return json(404, { ok: false, error: "candidate not found" }, origin);

  // Get text content
  let textContent = "";
  if (doc.extracted_text) {
    textContent = typeof doc.extracted_text === "string" ? doc.extracted_text : JSON.stringify(doc.extracted_text);
  } else if (doc.storage_path) {
    // Download from storage and extract text
    const { data: fileData } = await sb.storage
      .from("private-source-documents")
      .download(doc.storage_path);
    if (fileData) {
      textContent = await fileData.text();
    }
  }

  if (!textContent) {
    await sb.from("curriculum_source_documents").update({
      parse_status: "failed",
      parse_error: "no_text_content",
    }).eq("id", documentId);
    return json(200, { ok: false, error: "no_text_content" }, origin);
  }

  // Get parser strategy from source registry
  const { data: registry } = await sb
    .from("curriculum_source_registry")
    .select("parser_strategy")
    .eq("source_key", candidate.source_key)
    .single();

  const strategy = registry?.parser_strategy || "generic_certification";
  const parser = selectParser(strategy);
  const parsed = parser(textContent);

  // Upsert parsed result
  const { error: parseErr } = await sb.from("curriculum_intake_parsed").upsert({
    candidate_id: candidate.id,
    title_normalized: parsed.title_normalized,
    education_type: parsed.education_type,
    award_type: parsed.award_type,
    source_authority: parsed.source_authority,
    learning_fields: parsed.learning_fields,
    competency_areas: parsed.competency_areas,
    source_confidence: parsed.source_confidence,
    parsed_payload: parsed.parsed_payload,
  }, { onConflict: "candidate_id" });

  if (parseErr) {
    await sb.from("curriculum_source_documents").update({
      parse_status: "failed",
      parse_error: parseErr.message,
    }).eq("id", documentId);
    return json(500, { ok: false, error: parseErr.message }, origin);
  }

  await sb.from("curriculum_source_documents").update({
    parse_status: "parsed",
    parser_name: strategy,
    parser_version: "v1",
  }).eq("id", documentId);

  await sb.from("curriculum_intake_candidates").update({
    intake_status: "parsed",
  }).eq("id", candidate.id);

  return json(200, {
    ok: true,
    candidate_id: candidate.id,
    education_type: parsed.education_type,
    award_type: parsed.award_type,
    source_confidence: parsed.source_confidence,
  }, origin);
});
