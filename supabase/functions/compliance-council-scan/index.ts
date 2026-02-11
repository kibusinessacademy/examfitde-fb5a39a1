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

interface ScanPayload {
  scanType?: "full" | "pii" | "rls" | "retention" | "ai_act" | "azav_iso";
  courseId?: string;
  _job_id?: string;
  _job_type?: string;
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const body = await req.json();
    const p: ScanPayload = body.payload ?? body;
    const scanType = p.scanType ?? "full";

    console.log(`[ComplianceCouncil] Starting scan: ${scanType}`);

    const findings: FindingInput[] = [];

    // Phase 1: Automated checks
    if (scanType === "full" || scanType === "rls") {
      findings.push(...(await checkRLSPolicies(sb)));
    }
    if (scanType === "full" || scanType === "pii") {
      findings.push(...(await checkPIIExposure(sb)));
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

    // Phase 2: AI deliberation on findings (remediation plans)
    const enrichedFindings = await deliberateFindings(sb, findings);

    // Phase 3: Persist findings (upsert by title to avoid duplicates)
    let inserted = 0;
    let updated = 0;
    for (const f of enrichedFindings) {
      // Check if finding with same title+area already exists
      const { data: existing } = await sb
        .from("compliance_findings")
        .select("id, status")
        .eq("title", f.title)
        .eq("area", f.area)
        .maybeSingle();

      if (existing) {
        // Don't reopen resolved/accepted findings
        if (existing.status === "resolved" || existing.status === "accepted_risk") continue;
        await sb.from("compliance_findings").update({
          severity: f.severity,
          description: f.description,
          evidence_json: f.evidence_json,
          remediation_json: f.remediation_json,
        }).eq("id", existing.id);
        updated++;
      } else {
        await sb.from("compliance_findings").insert(f);
        inserted++;
      }
    }

    // Phase 4: Generate report snapshot
    const { data: openFindings } = await sb
      .from("compliance_findings")
      .select("id, area, severity, title, status")
      .in("status", ["open", "in_progress"])
      .order("severity");

    const summary = {
      scan_type: scanType,
      total_findings: enrichedFindings.length,
      inserted,
      updated,
      open_critical: (openFindings ?? []).filter((f: Record<string, string>) => f.severity === "critical").length,
      open_high: (openFindings ?? []).filter((f: Record<string, string>) => f.severity === "high").length,
      open_medium: (openFindings ?? []).filter((f: Record<string, string>) => f.severity === "medium").length,
      open_low: (openFindings ?? []).filter((f: Record<string, string>) => f.severity === "low").length,
      scanned_at: new Date().toISOString(),
    };

    await sb.from("compliance_reports").insert({
      report_type: scanType === "full" ? "weekly" : scanType === "azav_iso" ? "azav" : "release",
      scope_json: { scanType, courseId: p.courseId ?? null },
      summary_json: summary,
      findings_snapshot: openFindings ?? [],
    });

    // Phase 5: Recompute compliance block if courseId given
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

/* ── Finding type ── */
interface FindingInput {
  area: string;
  severity: string;
  title: string;
  description: string;
  evidence_json: Record<string, unknown>;
  remediation_json?: Record<string, unknown> | null;
}

/* ── Check: RLS Policies ── */
async function checkRLSPolicies(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Check tables without RLS
  const { data: tables } = await sb.rpc("get_tables_without_rls").catch(() => ({ data: null }));
  
  // Fallback: check known sensitive tables
  const sensitiveTables = [
    "profiles", "user_roles", "orders", "license_claim_codes",
    "enterprise_accounts", "enterprise_seats", "affiliate_payouts",
    "ai_tutor_logs", "support_tickets",
  ];

  for (const tableName of sensitiveTables) {
    // Check if table has overly permissive policies by querying pg_policies
    const { data: policies } = await sb
      .from("compliance_findings")  // dummy query to test connectivity
      .select("id")
      .limit(0);

    // We can't query pg_policies directly via supabase-js, so we flag known risks
    findings.push({
      area: "rls",
      severity: "medium",
      title: `RLS Audit: ${tableName}`,
      description: `Tabelle "${tableName}" enthält sensible Daten. RLS-Policies müssen geprüft werden: keine USING(true) für anon/public.`,
      evidence_json: { table: tableName, check: "manual_review_needed" },
    });
  }

  // If we got tables without RLS from RPC
  if (tables && Array.isArray(tables)) {
    for (const t of tables) {
      findings.push({
        area: "rls",
        severity: "critical",
        title: `RLS deaktiviert: ${t.table_name ?? t}`,
        description: `Tabelle "${t.table_name ?? t}" hat keine Row Level Security. Alle Daten sind ohne Authentifizierung zugänglich.`,
        evidence_json: { table: t.table_name ?? t, rls_enabled: false },
      });
    }
  }

  return findings;
}

/* ── Check: PII Exposure ── */
async function checkPIIExposure(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Check profiles table for PII columns
  const piiColumns = [
    { table: "profiles", columns: ["email", "full_name", "avatar_url"], risk: "medium" },
    { table: "enterprise_seats", columns: ["user_email"], risk: "high" },
    { table: "affiliate_payouts", columns: ["payment_method", "transaction_reference"], risk: "high" },
    { table: "support_tickets", columns: ["user_id", "description"], risk: "medium" },
    { table: "ai_tutor_logs", columns: ["user_id", "prompt_hash"], risk: "medium" },
  ];

  for (const check of piiColumns) {
    findings.push({
      area: "pii",
      severity: check.risk as string,
      title: `PII-Spalten: ${check.table}`,
      description: `Tabelle "${check.table}" enthält PII-Daten (${check.columns.join(", ")}). Zugriffsbeschränkung und Verschlüsselung prüfen.`,
      evidence_json: { table: check.table, pii_columns: check.columns },
    });
  }

  // Check if exports contain PII
  const { data: recentExports } = await sb
    .from("audit_exports")
    .select("id, export_type, created_at")
    .order("created_at", { ascending: false })
    .limit(5);

  if (recentExports?.length) {
    findings.push({
      area: "exports",
      severity: "medium",
      title: "Audit-Exports: PII-Prüfung ausstehend",
      description: `${recentExports.length} kürzliche Exports gefunden. Prüfen ob personenbezogene Daten enthalten sind (DSGVO Art. 25).`,
      evidence_json: { export_count: recentExports.length, recent_ids: recentExports.map((e: Record<string, string>) => e.id) },
    });
  }

  return findings;
}

/* ── Check: Data Retention ── */
async function checkRetention(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Check old tutor logs (>90 days)
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
      description: `${oldLogs} AI-Tutor-Logeinträge sind älter als 90 Tage. Datensparsamkeit gem. DSGVO Art. 5(1)(e) erfordert Löschkonzept.`,
      evidence_json: { old_log_count: oldLogs, threshold_days: 90 },
    });
  }

  // Check old AI usage logs
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

/* ── Check: AI Act Governance ── */
async function checkAIGovernance(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Check if AI usage is logged
  const { count: usageCount } = await sb
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true });

  if (!usageCount || usageCount === 0) {
    findings.push({
      area: "ai_act",
      severity: "critical",
      title: "AI-Nutzungsprotokollierung fehlt",
      description: "Keine Einträge in ai_usage_log. EU AI Act Art. 12 erfordert vollständige Protokollierung aller AI-Systemnutzungen.",
      evidence_json: { ai_usage_log_count: 0 },
    });
  }

  // Check AI worker policies exist
  const { count: policyCount } = await sb
    .from("ai_worker_policies")
    .select("job_type", { count: "exact", head: true });

  if (!policyCount || policyCount < 5) {
    findings.push({
      area: "ai_act",
      severity: "high",
      title: "AI Worker Policies unvollständig",
      description: `Nur ${policyCount ?? 0} AI Worker Policies definiert. Human-Oversight und Risikomanagement gem. EU AI Act Art. 14 sicherstellen.`,
      evidence_json: { policy_count: policyCount ?? 0 },
    });
  }

  // Check cost budgets
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
      description: "Kein AI-Kostenbudget für den aktuellen Monat definiert. Governance erfordert Kostenkontrolle.",
      evidence_json: { month: currentMonth },
    });
  }

  return findings;
}

/* ── Check: AZAV/ISO Readiness ── */
async function checkAZAVReadiness(sb: SB): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Check QM documents
  const { count: qmCount } = await sb
    .from("qm_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  if (!qmCount || qmCount < 3) {
    findings.push({
      area: "azav_iso",
      severity: "high",
      title: "QM-Dokumentation unvollständig",
      description: `Nur ${qmCount ?? 0} aktive QM-Dokumente. AZAV-Zertifizierung erfordert vollständiges QM-System (§ 178 SGB III).`,
      evidence_json: { active_qm_docs: qmCount ?? 0 },
    });
  }

  // Check Fachbereiche
  const { count: fbCount } = await sb
    .from("azav_fachbereiche")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (!fbCount || fbCount === 0) {
    findings.push({
      area: "azav_iso",
      severity: "critical",
      title: "Keine AZAV-Fachbereiche definiert",
      description: "Ohne zugelassene Fachbereiche ist keine Maßnahmenzulassung möglich (§ 179 SGB III).",
      evidence_json: { fachbereiche_count: 0 },
    });
  }

  // Check Maßnahmenzulassungen
  const { count: mzCount } = await sb
    .from("azav_massnahmen_zulassungen")
    .select("id", { count: "exact", head: true })
    .eq("zulassung_status", "zugelassen");

  if (!mzCount || mzCount === 0) {
    findings.push({
      area: "azav_iso",
      severity: "high",
      title: "Keine zugelassenen Maßnahmen",
      description: "Keine Bildungsmaßnahme hat den Status 'zugelassen'. Ohne Zulassung keine Bildungsgutschein-Abrechnung.",
      evidence_json: { zugelassen_count: 0 },
    });
  }

  return findings;
}

/* ── Phase 2: AI Deliberation for Remediation Plans ── */
async function deliberateFindings(sb: SB, findings: FindingInput[]): Promise<FindingInput[]> {
  if (!findings.length) return findings;

  // Only deliberate high/critical findings (cost control)
  const needsRemediation = findings.filter(f => f.severity === "high" || f.severity === "critical");
  if (!needsRemediation.length) return findings;

  try {
    // Proposer: Generate remediation plans
    const proposalResult = await callAIJSON({
      provider: "openai",
      model: PROPOSER_MODEL,
      messages: [
        {
          role: "system",
          content: `Du bist Compliance Council (Proposer). Für jedes Finding generiere einen konkreten Remediation Plan.
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
    try {
      const parsed = JSON.parse(proposalContent);
      remediations = parsed.remediations ?? [];
    } catch { /* ignore parse errors */ }

    // Validator: Check remediation quality
    const validationResult = await callAIJSON({
      provider: "anthropic",
      model: VALIDATOR_MODEL,
      messages: [
        {
          role: "system",
          content: `Du bist Compliance Council (Validator). Prüfe die Remediation Plans auf Korrektheit und Vollständigkeit.
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
    try {
      const parsed = JSON.parse(valContent);
      validated = parsed.validated ?? [];
    } catch { /* ignore */ }

    // Merge remediation plans into findings
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
    // Non-blocking: findings still get persisted without remediation
  }

  return findings;
}
