/**
 * KIMI Quality Intelligence Layer — shared helpers
 * READ-ONLY diagnostic layer. Never writes to pipeline tables.
 *
 * Provider: Lovable AI Gateway → anthropic/claude-sonnet-4.5
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const KIMI_MODEL = "google/gemini-3.1-pro-preview";
const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export type KimiModule =
  | "failure" | "coverage" | "drift" | "council"
  | "curriculum" | "didaktik" | "promotion" | "seo";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface KimiFinding {
  cluster_key: string;
  severity: Severity;
  title: string;
  summary: string;
  root_cause?: string;
  affected_count: number;
  affected_ids: unknown[];
  evidence: Record<string, unknown>;
  signals?: Record<string, unknown>;
  recommendations?: KimiRecommendation[];
}

export interface KimiRecommendation {
  priority: Priority;
  action_kind: string;
  title: string;
  rationale: string;
  proposed_payload?: Record<string, unknown>;
  target_table?: string;
  target_ids?: unknown[];
  estimated_impact?: Record<string, unknown>;
  estimated_effort?: "xs" | "s" | "m" | "l" | "xl";
}

export interface KimiAnalysisResult {
  findings: KimiFinding[];
  summary: string;
}

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function startSnapshot(
  sb: SupabaseClient,
  module: KimiModule,
  inputSummary: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await sb
    .from("quality_intelligence_snapshots")
    .insert({
      module,
      status: "running",
      model: KIMI_MODEL,
      input_summary: inputSummary,
    })
    .select("id")
    .single();
  if (error) throw new Error(`snapshot insert failed: ${error.message}`);
  return data.id as string;
}

export async function finishSnapshot(
  sb: SupabaseClient,
  snapshotId: string,
  patch: {
    status: "succeeded" | "failed" | "partial";
    output_summary?: Record<string, unknown>;
    finding_count?: number;
    recommendation_count?: number;
    tokens_input?: number;
    tokens_output?: number;
    duration_ms?: number;
    error_message?: string;
  },
) {
  await sb
    .from("quality_intelligence_snapshots")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", snapshotId);
}

export async function persistFindings(
  sb: SupabaseClient,
  snapshotId: string,
  module: KimiModule,
  findings: KimiFinding[],
): Promise<{ findingIds: string[]; recCount: number }> {
  if (findings.length === 0) return { findingIds: [], recCount: 0 };

  const findingRows = findings.map((f) => ({
    snapshot_id: snapshotId,
    module,
    cluster_key: f.cluster_key,
    severity: f.severity,
    title: f.title,
    summary: f.summary,
    root_cause: f.root_cause ?? null,
    affected_count: f.affected_count,
    affected_ids: f.affected_ids ?? [],
    evidence: f.evidence ?? {},
    signals: f.signals ?? {},
  }));

  const { data: insertedFindings, error: fErr } = await sb
    .from("quality_intelligence_findings")
    .insert(findingRows)
    .select("id");
  if (fErr) throw new Error(`findings insert failed: ${fErr.message}`);

  const findingIds = (insertedFindings ?? []).map((r: any) => r.id as string);

  // Persist recommendations linked to their finding
  const recRows: any[] = [];
  findings.forEach((f, idx) => {
    const fid = findingIds[idx];
    for (const r of f.recommendations ?? []) {
      recRows.push({
        snapshot_id: snapshotId,
        finding_id: fid,
        module,
        priority: r.priority,
        action_kind: r.action_kind,
        title: r.title,
        rationale: r.rationale,
        proposed_payload: r.proposed_payload ?? {},
        target_table: r.target_table ?? null,
        target_ids: r.target_ids ?? [],
        estimated_impact: r.estimated_impact ?? {},
        estimated_effort: r.estimated_effort ?? null,
      });
    }
  });

  if (recRows.length > 0) {
    const { error: rErr } = await sb
      .from("quality_intelligence_recommendations")
      .insert(recRows);
    if (rErr) throw new Error(`recommendations insert failed: ${rErr.message}`);
  }

  return { findingIds, recCount: recRows.length };
}

/**
 * Calls Lovable AI Gateway with Claude Sonnet 4.5 and forces JSON-shaped output.
 * Returns parsed KimiAnalysisResult.
 */
export async function callKimi(
  systemPrompt: string,
  userPayload: Record<string, unknown>,
): Promise<{ result: KimiAnalysisResult; tokens_input: number; tokens_output: number }> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");

  const body = {
    model: KIMI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Analysiere die folgenden Pipeline-Daten und antworte AUSSCHLIESSLICH mit gültigem JSON, " +
          "das exakt dem im System-Prompt definierten Schema entspricht. Kein Markdown, kein Fließtext, nur JSON.\n\nDATEN:\n" +
          JSON.stringify(userPayload, null, 2),
      },
    ],
    temperature: 0.2,
  };

  const res = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Kimi gateway error ${res.status}: ${txt.slice(0, 500)}`);
  }

  const json = await res.json();
  const rawContent: string = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};

  console.log(`[kimi] tokens=${usage.prompt_tokens ?? 0}/${usage.completion_tokens ?? 0} content_len=${rawContent.length}`);

  // Strip ```json ... ``` or ``` ... ``` wrappers
  let cleaned = rawContent.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Fallback: extract first {...} block
  if (!cleaned.startsWith("{")) {
    const idx = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (idx >= 0 && last > idx) cleaned = cleaned.slice(idx, last + 1);
  }

  let parsed: KimiAnalysisResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error("[kimi] parse failed, raw content head:", rawContent.slice(0, 800));
    throw new Error(`Kimi returned non-JSON: ${rawContent.slice(0, 300)}`);
  }

  if (!parsed.findings || !Array.isArray(parsed.findings)) {
    console.warn("[kimi] no findings array in response, keys:", Object.keys(parsed ?? {}));
    parsed = { findings: [], summary: (parsed as any)?.summary ?? "no findings" };
  }

  return {
    result: parsed,
    tokens_input: usage.prompt_tokens ?? 0,
    tokens_output: usage.completion_tokens ?? 0,
  };
}

export const RESPONSE_SCHEMA_INSTRUCTIONS = `
Antworte ausschließlich als JSON-Objekt mit dieser Struktur:
{
  "summary": "Ein-Satz-Zusammenfassung des Analysebefunds (Deutsch).",
  "findings": [
    {
      "cluster_key": "kurzer maschinenlesbarer Schlüssel, z.B. 'coverage_gap_marketing'",
      "severity": "info" | "low" | "medium" | "high" | "critical",
      "title": "Kurze menschenlesbare Überschrift",
      "summary": "1-3 Sätze, was beobachtet wurde",
      "root_cause": "vermutete Ursache",
      "affected_count": 12,
      "affected_ids": ["uuid1", "uuid2"],
      "evidence": { "metric": "value", "...": "..." },
      "signals": { "trend": "up|down|stable" },
      "recommendations": [
        {
          "priority": "P0" | "P1" | "P2" | "P3",
          "action_kind": "z.B. 'enqueue_coverage_repair' | 'recalibrate_blueprint' | 'manual_review'",
          "title": "Kurze Aktion",
          "rationale": "Warum diese Aktion",
          "proposed_payload": { "...": "..." },
          "target_table": "course_packages",
          "target_ids": ["uuid1"],
          "estimated_impact": { "revenue_eur_30d": 1200, "packages_unblocked": 8 },
          "estimated_effort": "xs" | "s" | "m" | "l" | "xl"
        }
      ]
    }
  ]
}

WICHTIG:
- Kimi darf NICHTS publizieren, approven, scoren oder Fragen freigeben.
- Empfehlungen sind ausschließlich Vorschläge für menschliche Entscheidung.
- Keine erfundenen IDs. Nur IDs aus den übergebenen Daten verwenden.
- Wenn keine Auffälligkeiten gefunden werden: leeres findings-Array zurückgeben.
`;
