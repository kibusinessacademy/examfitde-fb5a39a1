// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * SEO QC Check – Quality Gates S1-S6
 * Evaluates an seo_document and sets qc_score + qc_report.
 * If score >= 85 → status becomes "in_review"
 */

interface QCResult {
  gate: string;
  passed: boolean;
  score: number;
  max: number;
  detail: string;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { document_id } = await req.json();

    if (!document_id) {
      return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers });
    }

    const { data: doc, error: docErr } = await admin
      .from("seo_documents")
      .select("*")
      .eq("id", document_id)
      .single();

    if (docErr || !doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers });
    }

    const content = doc.content_md || "";
    const results: QCResult[] = [];

    // ── Gate S1: SSOT Reference ──
    const hasRef = !!(doc.beruf_id || doc.curriculum_id || doc.competency_id || doc.product_key);
    results.push({
      gate: "S1_SSOT",
      passed: hasRef,
      score: hasRef ? 15 : 0,
      max: 15,
      detail: hasRef ? "SSOT-Referenz vorhanden" : "KEINE SSOT-Referenz – blocked",
    });

    // ── Gate S2: Unique Content Hash ──
    let uniqueScore = 15;
    let uniqueDetail = "Content-Hash ist einzigartig";
    if (doc.content_hash) {
      const { data: dupes } = await admin
        .from("seo_documents")
        .select("id")
        .eq("content_hash", doc.content_hash)
        .neq("id", document_id)
        .limit(1);
      if (dupes && dupes.length > 0) {
        uniqueScore = 0;
        uniqueDetail = `Duplicate Hash gefunden (Doc: ${dupes[0].id})`;
      }
    }
    results.push({ gate: "S2_UNIQUE", passed: uniqueScore > 0, score: uniqueScore, max: 15, detail: uniqueDetail });

    // ── Gate S3: Similarity (n-gram approximation) ──
    // Simplified: check if first 100 chars appear in another published doc
    let simScore = 10;
    let simDetail = "Keine auffällige Ähnlichkeit";
    if (content.length > 100) {
      const snippet = content.substring(0, 100).replace(/'/g, "''");
      const { data: similar } = await admin
        .from("seo_documents")
        .select("id")
        .eq("status", "published")
        .neq("id", document_id)
        .ilike("content_md", `%${snippet.substring(0, 50)}%`)
        .limit(1);
      if (similar && similar.length > 0) {
        simScore = 3;
        simDetail = `Ähnlicher Content in Doc ${similar[0].id} gefunden`;
      }
    }
    results.push({ gate: "S3_SIMILARITY", passed: simScore >= 5, score: simScore, max: 10, detail: simDetail });

    // ── Gate S4: Human Tone ──
    let toneScore = 20;
    const toneIssues: string[] = [];
    const bannedPhrases = [
      "in diesem artikel", "zusammenfassend", "wie wir alle wissen",
      "es ist kein geheimnis", "garantiert bestehen", "100% erfolg",
      "ohne zweifel", "selbstverständlich",
    ];
    const contentLower = content.toLowerCase();
    for (const phrase of bannedPhrases) {
      if (contentLower.includes(phrase)) {
        toneScore -= 4;
        toneIssues.push(`Verbotene Phrase: "${phrase}"`);
      }
    }

    // Sentence length variation check
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 5);
    if (sentences.length > 3) {
      const lengths = sentences.map(s => s.trim().split(/\s+/).length);
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
      if (variance < 10) {
        toneScore -= 5;
        toneIssues.push("Geringe Satzlängenvariation (monoton)");
      }
    }

    // Active vs passive voice (simplified German check)
    const passivePatterns = /\b(wird|werden|wurde|wurden|worden)\b.*\b(ge\w+t|ge\w+en)\b/gi;
    const passiveCount = (content.match(passivePatterns) || []).length;
    if (passiveCount > 5) {
      toneScore -= 3;
      toneIssues.push(`Zu viel Passiv (${passiveCount} Stellen)`);
    }

    toneScore = Math.max(0, toneScore);
    results.push({
      gate: "S4_HUMAN_TONE",
      passed: toneScore >= 12,
      score: toneScore,
      max: 20,
      detail: toneIssues.length > 0 ? toneIssues.join("; ") : "Ton klingt natürlich und variiert",
    });

    // ── Gate S5: SERP Format ──
    let serpScore = 20;
    const serpIssues: string[] = [];

    const h1Count = (content.match(/^# [^#]/gm) || []).length;
    if (h1Count !== 1) {
      serpScore -= 5;
      serpIssues.push(`H1: ${h1Count} (erwartet: 1)`);
    }

    const h2Count = (content.match(/^## [^#]/gm) || []).length;
    if (h2Count < 2) {
      serpScore -= 5;
      serpIssues.push(`Nur ${h2Count} H2-Überschriften (min. 2 empfohlen)`);
    }

    // Check meta title length
    if (doc.meta_title && doc.meta_title.length > 60) {
      serpScore -= 3;
      serpIssues.push(`Meta-Title zu lang: ${doc.meta_title.length} Zeichen`);
    }

    // Check meta description length
    if (doc.meta_description && doc.meta_description.length > 160) {
      serpScore -= 3;
      serpIssues.push(`Meta-Description zu lang: ${doc.meta_description.length} Zeichen`);
    }

    // Internal links check
    const linkCount = (content.match(/\[.*?\]\(\/.*?\)/g) || []).length;
    if (linkCount < 1) {
      serpScore -= 4;
      serpIssues.push("Keine internen Links gefunden");
    }

    serpScore = Math.max(0, serpScore);
    results.push({
      gate: "S5_SERP_FORMAT",
      passed: serpScore >= 12,
      score: serpScore,
      max: 20,
      detail: serpIssues.length > 0 ? serpIssues.join("; ") : "SERP-Format OK",
    });

    // ── Gate S6: Policy ──
    let policyScore = 20;
    const policyIssues: string[] = [];
    const policyBanned = [
      "garantiert bestehen", "100% bestehensgarantie",
      "offizieller ihk-partner", "ihk-zertifiziert",
      "staatlich anerkannt",
    ];
    for (const phrase of policyBanned) {
      if (contentLower.includes(phrase)) {
        policyScore -= 5;
        policyIssues.push(`Policy-Verstoß: "${phrase}"`);
      }
    }
    policyScore = Math.max(0, policyScore);
    results.push({
      gate: "S6_POLICY",
      passed: policyScore >= 15,
      score: policyScore,
      max: 20,
      detail: policyIssues.length > 0 ? policyIssues.join("; ") : "Policy-konform",
    });

    // ── Aggregate ──
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const allPassed = results.every(r => r.passed);
    const newStatus = totalScore >= 85 && allPassed ? "in_review" : "draft";

    // Update document
    await admin.from("seo_documents").update({
      qc_score: totalScore,
      qc_report: { gates: results, total: totalScore, checked_at: new Date().toISOString() },
      status: doc.status === "draft" ? newStatus : doc.status,
    }).eq("id", document_id);

    return new Response(JSON.stringify({
      document_id,
      qc_score: totalScore,
      status: newStatus,
      gates: results,
      all_passed: allPassed,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[seo-qc-check] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
