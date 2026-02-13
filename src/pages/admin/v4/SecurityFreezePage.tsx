import { useEffect, useState, useCallback } from 'react';
import { Shield, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Loader2, TrendingUp, Lock, Building2, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════
// SECURITY FREEZE + RISK SCORE DASHBOARD
// ═══════════════════════════════════════════════════════════

interface RiskScore {
  id: string;
  score_date: string;
  overall_score: number;
  security_score: number;
  quality_score: number;
  compliance_score: number;
  operational_score: number;
  dimensions: Record<string, any>;
  recommendations: string[];
}

interface AuditSnapshot {
  id: string;
  policies_with_using_true: number;
  functions_without_search_path: number;
  views_without_invoker: number;
  tables_without_rls: number;
  total_issues: number;
  details: Record<string, any>;
  created_at: string;
}

interface TenantGate {
  id: string;
  company_id: string;
  gate_type: string;
  status: string;
  checks_passed: Record<string, any>;
  checks_failed: Record<string, any>;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
}

export default function SecurityFreezePage() {
  const [riskScores, setRiskScores] = useState<RiskScore[]>([]);
  const [audit, setAudit] = useState<AuditSnapshot | null>(null);
  const [tenantGates, setTenantGates] = useState<TenantGate[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    const [risksRes, auditRes, gatesRes] = await Promise.all([
      (supabase as any).from('platform_risk_scores').select('*').order('score_date', { ascending: false }).limit(30),
      (supabase as any).from('security_audit_snapshots').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      (supabase as any).from('tenant_release_gates').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    setRiskScores(risksRes.data || []);
    setAudit(auditRes.data);
    setTenantGates(gatesRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runSecurityScan = async () => {
    setScanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/security-gate-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: 'full_scan' }),
      });
      if (res.ok) {
        toast.success('Security Scan abgeschlossen');
        await load();
      } else {
        toast.error('Scan fehlgeschlagen');
      }
    } catch {
      toast.error('Fehler beim Scan');
    }
    setScanning(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  const latest = riskScores[0];
  const overallColor = (score: number) =>
    score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-yellow-600' : 'text-destructive';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Security Freeze & Risiko-Score</h1>
            <p className="text-sm text-muted-foreground">Zero-Trust Monitoring · Quarterly Audit · B2B Gates</p>
          </div>
        </div>
        <Button onClick={runSecurityScan} disabled={scanning} variant="outline" size="sm">
          {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Security Scan
        </Button>
      </div>

      {/* ═══ LAYER 1: PLATFORM RISK SCORE ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <ScoreCard label="Gesamt" score={latest?.overall_score} icon={Gauge} />
        <ScoreCard label="Security" score={latest?.security_score} icon={ShieldCheck} />
        <ScoreCard label="Qualität" score={latest?.quality_score} icon={CheckCircle2} />
        <ScoreCard label="Compliance" score={latest?.compliance_score} icon={Lock} />
        <ScoreCard label="Operations" score={latest?.operational_score} icon={TrendingUp} />
      </div>

      {/* Recommendations */}
      {latest?.recommendations && latest.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              Empfehlungen ({latest.recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {latest.recommendations.map((rec, i) => (
                <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                  <span className="text-yellow-500 mt-0.5">→</span>
                  {rec}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ═══ LAYER 2: SECURITY AUDIT SNAPSHOT ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Letzter Security Audit
            {audit && (
              <Badge variant="outline" className="text-[10px] ml-2">
                {new Date(audit.created_at).toLocaleString('de-DE')}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {audit ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <AuditMetric label="USING(true) Policies" value={audit.policies_with_using_true} good={audit.policies_with_using_true === 0} />
              <AuditMetric label="Functions ohne search_path" value={audit.functions_without_search_path} good={audit.functions_without_search_path === 0} />
              <AuditMetric label="Views ohne security_invoker" value={audit.views_without_invoker} good={audit.views_without_invoker === 0} />
              <AuditMetric label="Tabellen ohne RLS" value={audit.tables_without_rls} good={audit.tables_without_rls === 0} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Noch kein Audit durchgeführt. Starte einen Security Scan.</p>
          )}
        </CardContent>
      </Card>

      {/* ═══ LAYER 3: RISK SCORE HISTORY ═══ */}
      {riskScores.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Score-Verlauf (letzte {riskScores.length} Tage)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-24">
              {riskScores.slice(0, 30).reverse().map((s, i) => (
                <div
                  key={i}
                  className={cn("flex-1 rounded-t-sm min-w-[4px]",
                    s.overall_score >= 80 ? 'bg-emerald-500' :
                    s.overall_score >= 60 ? 'bg-yellow-500' : 'bg-destructive'
                  )}
                  style={{ height: `${Math.max(4, s.overall_score)}%` }}
                  title={`${s.score_date}: ${s.overall_score}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ LAYER 4: B2B TENANT RELEASE GATES ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            B2B Mandanten-Freigaben ({tenantGates.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tenantGates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine offenen Tenant-Gates</p>
          ) : (
            <div className="space-y-2">
              {tenantGates.map(gate => (
                <div key={gate.id} className="flex items-center justify-between border border-border rounded-lg p-3">
                  <div>
                    <span className="text-sm font-medium text-foreground">{gate.company_id.substring(0, 8)}…</span>
                    <Badge variant="outline" className={cn("text-[10px] ml-2",
                      gate.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                      gate.status === 'rejected' ? 'bg-destructive/10 text-destructive' :
                      'bg-yellow-500/10 text-yellow-600'
                    )}>{gate.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>✅ {Object.keys(gate.checks_passed || {}).length}</span>
                    <span>❌ {Object.keys(gate.checks_failed || {}).length}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ LAYER 5: FROZEN STATUS ═══ */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            <Lock className="h-8 w-8 text-primary" />
            <div>
              <h3 className="font-bold text-foreground">🔐 Security Freeze aktiv</h3>
              <p className="text-sm text-muted-foreground">
                Keine strukturellen Änderungen. Nur gezielte Patches nach Review.
                Nächster Quarterly Audit: Q2 2026
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreCard({ label, score, icon: Icon }: { label: string; score?: number; icon: any }) {
  const val = score ?? 0;
  const color = val >= 80 ? 'text-emerald-600' : val >= 60 ? 'text-yellow-600' : 'text-destructive';
  const bg = val >= 80 ? 'bg-emerald-500' : val >= 60 ? 'bg-yellow-500' : 'bg-destructive';

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <p className={cn("text-2xl font-bold", color)}>{score != null ? score : '–'}</p>
        <Progress value={val} className="h-1 mt-2" />
      </CardContent>
    </Card>
  );
}

function AuditMetric({ label, value, good }: { label: string; value: number; good: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("text-2xl font-bold", good ? 'text-emerald-600' : 'text-destructive')}>
        {value}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
      {good ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto mt-1" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive mx-auto mt-1" />
      )}
    </div>
  );
}
