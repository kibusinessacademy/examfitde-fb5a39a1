#!/usr/bin/env node
/**
 * ExamFit Export Audit Tool
 * Reads an export ZIP and produces audit_report.json + audit_report.md
 * 
 * Usage: node tools/audit-export.mjs <export.zip> [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

function pct(n, d) { return d === 0 ? 0 : Math.round((n / d) * 1000) / 10; }
function safeArray(x) { return Array.isArray(x) ? x : []; }

async function readJson(zip, file) {
  const f = zip.file(file);
  if (!f) return null;
  return JSON.parse(await f.async("string"));
}

async function main() {
  const zipPath = process.argv[2];
  const outDir = process.argv[3] ?? "audit_out";
  if (!zipPath) { console.error("Usage: node tools/audit-export.mjs <export.zip> [outDir]"); process.exit(1); }

  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));

  // Try quality_audit_full.json first (v6.0+)
  const auditFull = await readJson(zip, "quality_audit_full.json");
  if (auditFull) {
    console.log("✅ Found quality_audit_full.json (v6.0+) — using pre-computed audit.");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "audit_report.json"), JSON.stringify(auditFull, null, 2));
    
    const md = buildMarkdown(auditFull);
    fs.writeFileSync(path.join(outDir, "audit_report.md"), md);
    console.log(`📊 Score: ${auditFull.score.total}/100 (${auditFull.score.level})`);
    console.log(`📁 Output: ${outDir}/audit_report.json + audit_report.md`);
    return;
  }

  // Fallback: compute from raw data
  console.log("⚠️ No quality_audit_full.json — computing from raw export data...");
  
  const qualityAnalysis = await readJson(zip, "quality_analysis.json");
  const allQ = safeArray(await readJson(zip, "3_exam_pool/exam_questions_all.json"));
  const approvedQ = safeArray(await readJson(zip, "3_exam_pool/exam_questions_approved.json"));
  const learningFields = safeArray(await readJson(zip, "1_curriculum/learning_fields.json"));
  const competencies = safeArray(await readJson(zip, "1_curriculum/competencies.json"));
  const blueprints = safeArray(await readJson(zip, "2_blueprints/question_blueprints.json"));
  const councilFindings = safeArray(await readJson(zip, "5_governance/council_findings.json"));
  const validations = safeArray(await readJson(zip, "5_governance/ai_validations.json"));
  const redFlags = await readJson(zip, "red_flags.json") || { total_flags: 0, critical: 0 };

  const totalQ = allQ.length;
  const p = (n) => pct(n, totalQ);

  // Coverage
  const hasComp = allQ.filter(q => q.competency_id).length;
  const hasLf = allQ.filter(q => q.learning_field_id).length;
  const hasBp = allQ.filter(q => q.blueprint_id).length;
  const hasDiff = allQ.filter(q => q.difficulty).length;
  const hasCog = allQ.filter(q => q.cognitive_level && q.cognitive_level !== "unknown").length;

  // Elite metrics
  const eliteCnt = allQ.filter(q => q.elite_level === "elite").length;
  const evalCnt = allQ.filter(q => q.cognitive_level === "evaluate" || q.cognitive_level === "analyze").length;
  const knowCnt = allQ.filter(q => q.cognitive_level === "remember" || q.cognitive_level === "understand").length;
  const multiVarCnt = allQ.filter(q => q.multi_variable === true).length;
  const conflictCnt = allQ.filter(q => q.conflict_type && q.conflict_type !== "none" && q.conflict_type !== "").length;
  const transferCnt = allQ.filter(q => q.transfer_variant === true).length;
  const distrDiverseCnt = allQ.filter(q => Array.isArray(q.distractor_types) && q.distractor_types.length >= 3).length;
  const hasDistMeta = allQ.filter(q => q.distractor_meta).length;

  const approvedR = pct(approvedQ.length, totalQ);

  // Scoring
  const ssotScore = Math.min(30, Math.round((p(hasComp) + p(hasLf) + p(hasBp)) / 3 * 0.30));
  const metaScore = Math.min(25, Math.round((p(hasDiff) + p(hasCog)) * 0.12 + p(hasDistMeta) * 0.01));
  const depthScore = Math.min(25, Math.round(
    Math.min(10, p(multiVarCnt) * 0.10) + Math.min(6, p(conflictCnt) * 0.06) +
    Math.min(4, p(transferCnt) * 0.04) + Math.min(5, p(evalCnt) * 0.05)
  ));
  const govScore = Math.min(10, (approvedR >= 95 ? 6 : Math.round(approvedR * 0.06)) + (councilFindings.length > 0 ? 2 : 0) + (validations.length > 0 ? 2 : 0));
  const riskScore = Math.max(0, 10 - Math.min(10, (redFlags.total_flags || 0)));
  const totalScore = ssotScore + metaScore + depthScore + govScore + riskScore;
  const level = totalScore >= 90 ? "elite_ready" : totalScore >= 75 ? "strong" : totalScore >= 60 ? "medium" : "blocked";

  // Rules
  const rules = [];
  const gate = (id, ok, pass, fail) => rules.push({ id, status: ok ? "pass" : "fail", reason: ok ? pass : fail });
  gate("G0_SSOT_BINDING", p(hasComp) >= 98 && p(hasLf) >= 98, "SSOT binding ≥98%", "SSOT binding incomplete");
  gate("G1_APPROVAL", approvedR >= 95, "Approved ≥95%", `Approved only ${approvedR}%`);
  gate("G2_META", p(hasDiff) >= 98 && p(hasCog) >= 98, "Meta coverage ≥98%", "Missing difficulty/cognitive_level");
  gate("E1_MULTIVAR", p(multiVarCnt) >= 25, "Multi-variable ≥25%", `Multi-variable only ${p(multiVarCnt)}%`);
  gate("E2_EVALUATE", p(evalCnt) >= 15, "Evaluate ≥15%", `Evaluate only ${p(evalCnt)}%`);
  gate("E3_KNOWLEDGE", p(knowCnt) <= 20, "Knowledge ≤20%", `Knowledge ${p(knowCnt)}% (too high)`);

  // LF aggregation
  const lfAgg = {};
  for (const q of allQ) {
    const lfId = q.learning_field_id || "_none";
    if (!lfAgg[lfId]) lfAgg[lfId] = { total: 0, elite: 0, evaluate: 0, knowledge: 0, multivar: 0, conflict: 0, transfer: 0 };
    const a = lfAgg[lfId]; a.total++;
    if (q.elite_level === "elite") a.elite++;
    if (q.cognitive_level === "evaluate" || q.cognitive_level === "analyze") a.evaluate++;
    if (q.cognitive_level === "remember" || q.cognitive_level === "understand") a.knowledge++;
    if (q.multi_variable === true) a.multivar++;
    if (q.conflict_type && q.conflict_type !== "none") a.conflict++;
    if (q.transfer_variant === true) a.transfer++;
  }

  const result = {
    meta: {
      export_version: qualityAnalysis?.export_version || "unknown",
      created_at: new Date().toISOString(),
      track_type: qualityAnalysis?.track_type || "unknown",
    },
    score: { total: totalScore, level, bands: { ssot: ssotScore, metadata: metaScore, depth: depthScore, governance: govScore, risk: riskScore } },
    rules,
    elite_metrics: {
      total_questions: totalQ,
      elite_count: eliteCnt, elite_ratio: p(eliteCnt),
      evaluate_ratio: p(evalCnt), knowledge_ratio: p(knowCnt),
      multi_variable_ratio: p(multiVarCnt), conflict_ratio: p(conflictCnt),
      transfer_ratio: p(transferCnt), distractor_diversity_ratio: p(distrDiverseCnt),
    },
    coverage: { competency_id: p(hasComp), learning_field_id: p(hasLf), blueprint_id: p(hasBp), difficulty: p(hasDiff), cognitive_level: p(hasCog) },
    lf_elite_aggregation: Object.entries(lfAgg).map(([lfId, a]) => ({
      learning_field_id: lfId, total: a.total,
      elite_ratio: pct(a.elite, a.total), evaluate_ratio: pct(a.evaluate, a.total),
      knowledge_ratio: pct(a.knowledge, a.total), multi_variable_ratio: pct(a.multivar, a.total),
    })),
    governance_summary: {
      approved_ratio: approvedR,
      council_findings: councilFindings.length,
      ai_validations: validations.length,
      red_flags_total: redFlags.total_flags || 0,
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "audit_report.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "audit_report.md"), buildMarkdown(result));
  console.log(`📊 Score: ${totalScore}/100 (${level})`);
  console.log(`📁 Output: ${outDir}/`);
}

function buildMarkdown(r) {
  const lines = [
    `# ExamFit Export Audit Report`, ``,
    `**Version:** ${r.meta.export_version}`,
    `**Track:** ${r.meta.track_type}`,
    `**Generated:** ${r.meta.created_at}`, ``,
    `## Score: ${r.score.total}/100 — ${r.score.level.toUpperCase()}`, ``,
    `| Band | Score |`, `|------|-------|`,
    ...Object.entries(r.score.bands).map(([k, v]) => `| ${k} | ${v} |`), ``,
    `## Rules`, ``,
    ...r.rules.map(r => `- **${r.id}**: ${r.status.toUpperCase()} — ${r.reason}`), ``,
    `## Elite Metrics`, ``,
    `| Metric | Value |`, `|--------|-------|`,
    ...Object.entries(r.elite_metrics).map(([k, v]) => `| ${k} | ${v}${typeof v === "number" && k.includes("ratio") ? "%" : ""} |`), ``,
    `## Coverage`, ``,
    ...Object.entries(r.coverage).map(([k, v]) => `- ${k}: ${v}%`), ``,
  ];
  if (r.lf_elite_aggregation?.length) {
    lines.push(`## LF Elite Aggregation`, ``);
    lines.push(`| LF | Total | Elite% | Evaluate% | Knowledge% | MultiVar% |`);
    lines.push(`|----|-------|--------|-----------|------------|-----------|`);
    for (const lf of r.lf_elite_aggregation) {
      lines.push(`| ${lf.learning_field_title || lf.learning_field_id?.slice(0, 8)} | ${lf.total_questions || lf.total} | ${lf.elite_ratio}% | ${lf.evaluate_ratio}% | ${lf.knowledge_ratio}% | ${lf.multi_variable_ratio}% |`);
    }
  }
  return lines.join("\n");
}

main().catch(err => { console.error(err); process.exit(1); });
