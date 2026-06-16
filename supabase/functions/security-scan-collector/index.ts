// Security Scan Collector
// Runs scheduled scans across multiple sources (Supabase DB heuristics, optional
// Wiz API, externally posted payloads), categorizes findings, deduplicates them,
// and auto-creates tickets for new findings via ingest_security_scan_findings RPC.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WIZ_API_TOKEN = Deno.env.get('WIZ_API_TOKEN'); // optional
const WIZ_API_URL = Deno.env.get('WIZ_API_URL');     // optional

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Category =
  | 'rls_missing' | 'rls_permissive' | 'exposed_pii' | 'exposed_secrets'
  | 'security_definer_view' | 'privilege_escalation' | 'dependency_vuln'
  | 'connector_finding' | 'config_drift' | 'other';

interface RawFinding {
  title: string;
  description?: string;
  target?: string;
  severity?: Severity;
  category?: Category;
  evidence?: Record<string, unknown>;
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

async function startRun(scanner: string, source: string): Promise<string> {
  const { data, error } = await supabase
    .from('security_scan_runs')
    .insert({ scanner, source, status: 'running' })
    .select('id').single();
  if (error) throw error;
  return data.id;
}

async function failRun(runId: string, err: unknown) {
  await supabase.from('security_scan_runs').update({
    status: 'failed',
    finished_at: new Date().toISOString(),
    error: String(err instanceof Error ? err.message : err),
  }).eq('id', runId);
}

async function ingest(runId: string, scanner: string, findings: RawFinding[]) {
  const { data, error } = await supabase.rpc('ingest_security_scan_findings', {
    p_run_id: runId,
    p_scanner: scanner,
    p_findings: findings,
  });
  if (error) throw error;
  return data?.[0] ?? { new_count: 0, updated_count: 0, tickets_created: 0 };
}

// --- Supabase DB heuristic scanner ---
async function scanSupabaseDb(): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];

  // 1. Tables with RLS enabled but no policies
  const { data: noPolicy } = await supabase.rpc('exec_security_audit_query' as never, {} as never)
    .then(r => r, () => ({ data: null }));
  // Fallback: use information_schema via PostgREST won't work for pg_class;
  // we rely on a dedicated SQL function if present, else skip.

  if (Array.isArray(noPolicy)) {
    for (const row of noPolicy as Array<{ table_name: string; issue: string; severity: Severity }>) {
      findings.push({
        title: `${row.issue}: ${row.table_name}`,
        target: `public.${row.table_name}`,
        severity: row.severity,
        category: row.issue.includes('no_policy') ? 'rls_missing'
          : row.issue.includes('permissive') ? 'rls_permissive'
          : 'config_drift',
        evidence: row,
      });
    }
  }

  return findings;
}

// --- Wiz scanner (optional, only if WIZ_API_TOKEN provided) ---
async function scanWiz(): Promise<RawFinding[]> {
  if (!WIZ_API_TOKEN || !WIZ_API_URL) return [];
  try {
    const res = await fetch(`${WIZ_API_URL}/issues?status=OPEN`, {
      headers: { Authorization: `Bearer ${WIZ_API_TOKEN}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items = Array.isArray(json?.data) ? json.data : [];
    return items.map((i: Record<string, unknown>) => ({
      title: String(i.name ?? i.title ?? 'Wiz issue'),
      description: String(i.description ?? ''),
      target: String(i.entityName ?? i.resource ?? ''),
      severity: mapWizSeverity(String(i.severity ?? 'medium')),
      category: 'connector_finding' as Category,
      evidence: i,
    }));
  } catch (e) {
    console.error('Wiz scan failed', e);
    return [];
  }
}

function mapWizSeverity(s: string): Severity {
  const v = s.toLowerCase();
  if (v.includes('crit')) return 'critical';
  if (v.includes('high')) return 'high';
  if (v.includes('med')) return 'medium';
  if (v.includes('low')) return 'low';
  return 'info';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const source = url.searchParams.get('source') ?? 'cron';

  const results: Record<string, unknown> = {};

  try {
    // Allow external scanners to POST findings directly
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const scanner = String(body.scanner ?? 'external');
      const findings = Array.isArray(body.findings) ? body.findings as RawFinding[] : [];
      const runId = await startRun(scanner, source);
      try {
        const r = await ingest(runId, scanner, findings);
        results[scanner] = r;
      } catch (e) { await failRun(runId, e); throw e; }
      return new Response(JSON.stringify({ ok: true, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cron path: run all internal scanners
    for (const [scanner, fn] of [
      ['supabase_db', scanSupabaseDb],
      ['wiz', scanWiz],
    ] as const) {
      const runId = await startRun(scanner, source);
      try {
        const findings = await fn();
        results[scanner] = await ingest(runId, scanner, findings);
      } catch (e) {
        await failRun(runId, e);
        results[scanner] = { error: String(e instanceof Error ? e.message : e) };
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
