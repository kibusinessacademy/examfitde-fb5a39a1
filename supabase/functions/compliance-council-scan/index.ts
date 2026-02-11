import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { callAIJSON } from "../_shared/ai-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/* ── Model config ── */
const PROPOSER_MODEL = "openai/gpt-4.1";
const VALIDATOR_MODEL = "anthropic/claude-sonnet-4-20250514";
const PROPOSER_LABEL = "gpt-4.1";
const VALIDATOR_LABEL = "claude-sonnet-4";

type SB = ReturnType<typeof createClient>;

/**
 * Council 6: Compliance & Data Protection Council
 * 
 * Phase 1: Automated checks via catalog RPCs (RLS, policies, PII, retention, AI Act, AZAV)
 * Phase 2: AI deliberation for remediation plans (high/critical only)
 * Phase 3: Persist findings via idempotent upsert RPC
 * Phase 4: Generate report snapshot
 * Phase 5: Recompute compliance_blocked for courseId
 */

const SENSITIVE_TABLES = [
  "profiles", "orders", "enterprise_accounts", "enterprise_seats",
  "user_entitlements", "license_claim_codes", "tutor_assets",
  "ai_tutor_logs", "support_tickets", "affiliate_payouts",
  "job_queue", "admin_patch_plans", "marketing_assets", "exam_questions",
] as const;

interface ScanPayload {
  scanType?: "full" | "pii" | "rls" | "retention" | "ai_act" | "azav_iso";
  courseId?: string;
  _job_id?: string;
  _job_type?: string;
}

interface FindingInput {
  area: string;
  severity: string;
  title: string;
  description: string;
  evidence_json: Record<string, unknown>;
  remediation_json?: Record<string, unknown> | null;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const p: ScanPayload = body.payload ?? body;
    const scanType = p.scanType ?? "full";

    console.log(`[ComplianceCouncil] Starting scan: ${scanType}`);

    const findings: FindingInput[] = [];

    // ── Phase 1: Automated checks ──
    if (scanType === "full" || scanType === "rls") {
      findings.push(...(await checkRLS(sb)));
      findings.push(...(await checkPolicies(sb)));
    }
    if (scanType === "full" || scanType === "pii") {
      findings.push(...checkPIIExposure());
    }
    if (scanType === "full" || scanType === "retention") {
      findings.push(...(await checkRetention(sb)));
    }
    if (scanType === "full" || scanType === "ai_act") {
      findings.push(...(await checkAIGovernance(sb)));
    }
    if (scanType === "full" || scanType === "azav_iso") {
      findings.push(...(await checkAZAVReadiness(sb)));
    }

    // ── Phase 2: AI deliberation (high/critical only) ──
    const enriched = await deliberateFindings(findings);

    // ── Phase 3: Persist via idempotent upsert RPC ──
    let upserted = 0;
    for (const f of enriched) {
      const { error } = await sb.rpc("upsert_compliance_finding", {
        p_area: f.area,
        p_severity: f.severity,
        p_title: f.title,
        p_description: f.description,
        p_evidence: { ...f.evidence_json, remediation: f.remediation_json ?? null },
      });
      if (error) console.warn(`[ComplianceCouncil] upsert error: ${error.message}`);
      else upserted++;
    }

    // ── Phase 4: Report snapshot ──
    const { data: openFindings } = await sb
      .from("compliance_findings")
      .select("id, area, severity, title, status")
      .in("status", ["open", "in_progress"])
      .order("severity");

    const open = openFindings ?? [];
    const summary = {
      scan_type: scanType,
      total_findings: enriched.length,
      upserted,
      open_critical: open.filter((f: Record<string, string>) => f.severity === "critical").length,
      open_high: open.filter((f: Record<string, string>) => f.severity === "high").length,
      open_medium: open.filter((f: Record<string, string>) => f.severity === "medium").length,
      open_low: open.filter((f: Record<string, string>) => f.severity === "low").length,
      scanned_at: new Date().toISOString(),
    };

    await sb.from("compliance_reports").insert({
      report_type: scanType === "full" ? "weekly" : scanType === "azav_iso" ? "azav" : "release",
      scope_json: { scanType, courseId: p.courseId ?? null },
      summary_json: summary,
      findings_snapshot: open,
    });

    // ── Phase 5: Recompute compliance block ──
    if (p.courseId) {
      await sb.rpc("recompute_compliance_block", { p_course_id: p.courseId });
    }

    return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ComplianceCouncil] Error:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers });
  }
});

/* ────────────────────────────────────────────
 * Check: RLS enabled on sensitive tables
 * Uses compliance_rls_status() RPC
 * ──────────────────────────────────────────── */
async function checkRLS(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const { data, error } = await sb.rpc("compliance_rls_status", { p_tables: [...SENSITIVE_TABLES] });
  if (error) { console.warn("[ComplianceCouncil] rls_status RPC error:", error.message); return findings; }

  for (const row of (data ?? []) as Array<{ tablename: string; rls_enabled: boolean; force_rls: boolean }>) {
    if (!row.rls_enabled) {
      findings.push({
        area: "rls",
        severity: "critical",
        title: `RLS deaktiviert: ${row.tablename}`,
        description: `Tabelle public.${row.tablename} hat keine Row Level Security. Alle Daten sind ohne Authentifizierung zugänglich.`,
        evidence_json: { table: row.tablename, rls_enabled: false, force_rls: row.force_rls },
      });
    }
  }
  return findings;
}

/* ────────────────────────────────────────────
 * Check: Policy safety on sensitive tables
 * Uses compliance_policies() RPC
 * ──────────────────────────────────────────── */
async function checkPolicies(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const { data, error } = await sb.rpc("compliance_policies", { p_tables: [...SENSITIVE_TABLES] });
  if (error) { console.warn("[ComplianceCouncil] policies RPC error:", error.message); return findings; }

  interface PolicyRow { tablename: string; policyname: string; roles: string[]; qual: string; with_check: string }
  for (const p of (data ?? []) as PolicyRow[]) {
    const roles = p.roles ?? [];
    const qual = (p.qual ?? "").trim();
    const withCheck = (p.with_check ?? "").trim();

    const rolesHasPublic = roles.includes("public");
    const qualIsTrivial = qual === "true" || qual === "" || qual === "(true)";
    const looksUnguarded = !qual.includes("is_admin") && !qual.includes("auth.uid")
      && !withCheck.includes("is_admin") && !withCheck.includes("auth.uid");

    if (rolesHasPublic && qualIsTrivial) {
      findings.push({
        area: "security",
        severity: "critical",
        title: `Unsafe policy: public auf ${p.tablename} (${p.policyname})`,
        description: `Policy erlaubt Zugriff für "public" mit trivialer Bedingung (qual="${qual}").`,
        evidence_json: { table: p.tablename, policy: p.policyname, roles, qual },
      });
    } else if (qualIsTrivial && looksUnguarded) {
      findings.push({
        area: "security",
        severity: "high",
        title: `Weak policy: ${p.tablename} (${p.policyname})`,
        description: `Policy wirkt ungeschützt (qual="${qual}"). Prüfe ob nur Admin/Owner Zugriff hat.`,
        evidence_json: { table: p.tablename, policy: p.policyname, roles, qual },
      });
    }
  }
  return findings;
}

/* ────────────────────────────────────────────
 * Check: PII Exposure (static catalog)
 * ──────────────────────────────────────────── */
function checkPIIExposure(): FindingInput[] {
  const piiChecks = [
    { table: "profiles", columns: ["email", "full_name", "avatar_url"], risk: "medium" as const },
    { table: "enterprise_seats", columns: ["user_email"], risk: "high" as const },
    { table: "affiliate_payouts", columns: ["payment_method", "transaction_reference"], risk: "high" as const },
    { table: "support_tickets", columns: ["user_id", "description"], risk: "medium" as const },
    { table: "ai_tutor_logs", columns: ["user_id", "prompt_hash"], risk: "medium" as const },
  ];

  return piiChecks.map(c => ({
    area: "pii",
    severity: c.risk,
    title: `PII-Spalten: ${c.table}`,
    description: `Tabelle "${c.table}" enthält PII (${c.columns.join(", ")}). Zugriff und Verschlüsselung prüfen.`,
    evidence_json: { table: c.table, pii_columns: c.columns },
  }));
}

/* ────────────────────────────────────────────
 * Check: Data Retention
 * ──────────────────────────────────────────── */
async function checkRetention(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { count: oldLogs } = await sb
    .from("ai_tutor_logs")
    .select("id", { count: "exact", head: true })
    .lt("created_at", ninetyDaysAgo);

  if (oldLogs && oldLogs > 0) {
    findings.push({
      area: "retention",
      severity: "high",
      title: "Tutor-Logs ohne TTL (>90 Tage)",
      description: `${oldLogs} AI-Tutor-Logs älter als 90 Tage. DSGVO Art. 5(1)(e) erfordert Löschkonzept.`,
      evidence_json: { old_log_count: oldLogs, threshold_days: 90 },
    });
  }

  const { count: oldUsage } = await sb
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .lt("created_at", ninetyDaysAgo);

  if (oldUsage && oldUsage > 100) {
    findings.push({
      area: "retention",
      severity: "medium",
      title: "AI Usage Logs: Retention-Policy fehlt",
      description: `${oldUsage} AI-Nutzungslogs älter als 90 Tage. Aufbewahrungsfristen definieren.`,
      evidence_json: { old_count: oldUsage, threshold_days: 90 },
    });
  }
  return findings;
}

/* ────────────────────────────────────────────
 * Check: AI Act Governance
 * ──────────────────────────────────────────── */
async function checkAIGovernance(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  const { count: usageCount } = await sb
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true });

  if (!usageCount || usageCount === 0) {
    findings.push({
      area: "ai_act",
      severity: "critical",
      title: "AI-Nutzungsprotokollierung fehlt",
      description: "Keine Einträge in ai_usage_log. EU AI Act Art. 12 erfordert vollständige Protokollierung.",
      evidence_json: { ai_usage_log_count: 0 },
    });
  }

  const { count: policyCount } = await sb
    .from("ai_worker_policies")
    .select("job_type", { count: "exact", head: true });

  if (!policyCount || policyCount < 5) {
    findings.push({
      area: "ai_act",
      severity: "high",
      title: "AI Worker Policies unvollständig",
      description: `Nur ${policyCount ?? 0} Policies. EU AI Act Art. 14 erfordert Human-Oversight.`,
      evidence_json: { policy_count: policyCount ?? 0 },
    });
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: budget } = await sb
    .from("ai_cost_budgets")
    .select("budget_eur, spent_eur")
    .eq("month", currentMonth)
    .maybeSingle();

  if (!budget) {
    findings.push({
      area: "ai_act",
      severity: "medium",
      title: `AI-Kostenbudget fehlt (${currentMonth})`,
      description: "Kein AI-Kostenbudget für den aktuellen Monat definiert.",
      evidence_json: { month: currentMonth },
    });
  }
  return findings;
}

/* ────────────────────────────────────────────
 * Check: AZAV/ISO Readiness
 * ──────────────────────────────────────────── */
async function checkAZAVReadiness(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  const { count: qmCount } = await sb
    .from("qm_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (!qmCount || qmCount < 3) {
    findings.push({
      area: "azav_iso",
      severity: "high",
      title: "QM-Dokumentation unvollständig",
      description: `Nur ${qmCount ?? 0} aktive QM-Dokumente. AZAV erfordert vollständiges QM-System (§ 178 SGB III).`,
      evidence_json: { active_qm_docs: qmCount ?? 0 },
    });
  }

  const { count: fbCount } = await sb
    .from("azav_fachbereiche")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (!fbCount || fbCount === 0) {
    findings.push({
      area: "azav_iso",
      severity: "critical",
      title: "Keine AZAV-Fachbereiche definiert",
      description: "Ohne zugelassene Fachbereiche keine Maßnahmenzulassung möglich (§ 179 SGB III).",
      evidence_json: { fachbereiche_count: 0 },
    });
  }

  const { count: mzCount } = await sb
    .from("azav_massnahmen_zulassungen")
    .select("id", { count: "exact", head: true })
    .eq("zulassung_status", "zugelassen");

  if (!mzCount || mzCount === 0) {
    findings.push({
      area: "azav_iso",
      severity: "high",
      title: "Keine zugelassenen Maßnahmen",
      description: "Keine Maßnahme hat Status 'zugelassen'. Ohne Zulassung keine Bildungsgutschein-Abrechnung.",
      evidence_json: { zugelassen_count: 0 },
    });
  }
  return findings;
}

/* ────────────────────────────────────────────
 * Phase 2: AI Deliberation (remediation plans)
 * ──────────────────────────────────────────── */
async function deliberateFindings(findings: FindingInput[]): Promise<FindingInput[]> {
  const needsRemediation = findings.filter(f => f.severity === "high" || f.severity === "critical");
  if (!needsRemediation.length) return findings;

  try {
    const proposalResult = await callAIJSON({
      provider: "openai",
      model: PROPOSER_MODEL,
      messages: [
        {
          role: "system",
          content: `Du bist Compliance Council (Proposer: ${PROPOSER_LABEL}). Für jedes Finding generiere einen Remediation Plan.
Output STRICT JSON: { "remediations": [{ "title": "...", "steps": ["..."], "priority": "immediate|short_term|long_term", "effort": "low|medium|high" }] }
Beachte: DSGVO, EU AI Act, AZAV/SGB III, ISO 29993.`,
        },
        {
          role: "user",
          content: JSON.stringify(needsRemediation.map(f => ({ title: f.title, area: f.area, severity: f.severity, description: f.description }))).slice(0, 8000),
        },
      ],
      temperature: 0.3,
    });

    const proposalContent = proposalResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let remediations: Array<Record<string, unknown>> = [];
    try { remediations = (JSON.parse(proposalContent)).remediations ?? []; } catch { /* ignore */ }

    const validationResult = await callAIJSON({
      provider: "anthropic",
      model: VALIDATOR_MODEL,
      messages: [
        {
          role: "system",
          content: `Du bist Compliance Council (Validator: ${VALIDATOR_LABEL}). Prüfe Remediation Plans.
Output STRICT JSON: { "validated": [{ "index": N, "ok": boolean, "issues": ["..."] }] }`,
        },
        {
          role: "user",
          content: JSON.stringify({ findings: needsRemediation.map(f => f.title), remediations }).slice(0, 8000),
        },
      ],
      temperature: 0.2,
    });

    const valContent = validationResult.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let validated: Array<Record<string, unknown>> = [];
    try { validated = (JSON.parse(valContent)).validated ?? []; } catch { /* ignore */ }

    for (let i = 0; i < needsRemediation.length; i++) {
      const rem = remediations[i];
      const val = validated.find((v: Record<string, unknown>) => v.index === i);
      if (rem) {
        needsRemediation[i].remediation_json = {
          ...rem,
          validator_ok: val?.ok ?? null,
          validator_issues: val?.issues ?? [],
          proposer: PROPOSER_LABEL,
          validator: VALIDATOR_LABEL,
        };
      }
    }
  } catch (err) {
    console.warn("[ComplianceCouncil] AI deliberation failed (non-blocking):", err);
  }

  return findings;
}
