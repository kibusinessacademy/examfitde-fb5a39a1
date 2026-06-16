/**
 * KIMI Council Intelligence
 * Analyzes WHY the council rejects content. Looks at council_verdicts + council_decisions
 * + required_fixes patterns. Output: top rejection causes the generator should fix.
 * READ-ONLY.
 */
import {
  corsHeaders, getServiceClient, startSnapshot, finishSnapshot,
  persistFindings, callKimi, RESPONSE_SCHEMA_INSTRUCTIONS,
} from "../_shared/kimi-qil.ts";

const SYSTEM_PROMPT = `Du bist KIMI — Council Intelligence Auditor für ExamFit.
Du erhältst die Council-Entscheidungen der letzten 14 Tage: verdicts, decisions, required_fixes, scores.

Aufgabe:
1. Cluster die häufigsten Ablehnungsgründe (z.B. "Praxisbezug fehlt", "Distraktoren zu schwach").
2. Quantifiziere: wie oft, in welchen Tracks/Zertifizierungen, mit welchem mittleren Score.
3. Schlage konkrete Generator-Verbesserungen vor (z.B. Blueprint-Prompt anpassen, Distraktor-Regel verschärfen).
4. Markiere Cluster mit hoher Auftrittshäufigkeit als P0/P1 — das ist der größte Hebel zur Score-Steigerung.

Du darfst NICHTS scoren, approven oder ändern. Nur diagnostizieren.

${RESPONSE_SCHEMA_INSTRUCTIONS}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = getServiceClient();
  const t0 = Date.now();
  let snapshotId: string | null = null;

  try {
    const since = new Date(Date.now() - 14 * 86400_000).toISOString();

    const [verdicts, decisions] = await Promise.all([
      sb.from("council_verdicts")
        .select("id, council_id, verdict, score, rationale, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      sb.from("council_decisions")
        .select("id, content_version_id, final_decision, consensus_score, required_fixes, decided_at")
        .gte("decided_at", since)
        .order("decided_at", { ascending: false })
        .limit(300),
    ]);

    const inputSummary = {
      window_days: 14,
      verdicts_count: verdicts.data?.length ?? 0,
      decisions_count: decisions.data?.length ?? 0,
    };

    snapshotId = await startSnapshot(sb, "council", inputSummary);

    if (inputSummary.verdicts_count + inputSummary.decisions_count === 0) {
      await finishSnapshot(sb, snapshotId, {
        status: "succeeded", finding_count: 0, recommendation_count: 0,
        duration_ms: Date.now() - t0,
        output_summary: { message: "no council activity in window" },
      });
      return new Response(JSON.stringify({ ok: true, snapshot_id: snapshotId, findings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { result, tokens_input, tokens_output } = await callKimi(SYSTEM_PROMPT, {
      verdicts: verdicts.data ?? [],
      decisions: decisions.data ?? [],
    });

    const { recCount } = await persistFindings(sb, snapshotId, "council", result.findings);

    await finishSnapshot(sb, snapshotId, {
      status: "succeeded",
      finding_count: result.findings.length,
      recommendation_count: recCount,
      tokens_input, tokens_output,
      duration_ms: Date.now() - t0,
      output_summary: { summary: result.summary, ...inputSummary },
    });

    return new Response(JSON.stringify({
      ok: true, snapshot_id: snapshotId,
      findings: result.findings.length, recommendations: recCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (snapshotId) {
      await finishSnapshot(sb, snapshotId, {
        status: "failed", error_message: msg, duration_ms: Date.now() - t0,
      });
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
