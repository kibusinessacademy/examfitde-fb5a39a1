import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Database, TrendingUp, GitBranch } from 'lucide-react';
import { toast } from 'sonner';

interface DriftResult {
  ok: boolean;
  drift_count: number;
  critical_count: number;
  checked_at: string;
  drifts: Array<{
    type: string;
    entity: string;
    expected?: string;
    actual?: string;
    critical: boolean;
  }>;
}

interface ContractSummary {
  total: number;
  active: number;
  deprecated: number;
  byType: Record<string, number>;
}

interface LedgerEntry {
  function_name: string;
  required_migration: string;
  verified_ok: boolean | null;
  last_verified_at: string | null;
}

interface RpcVersion {
  rpc_name: string;
  version: number;
  is_current: boolean;
  deprecated_at: string | null;
  successor_rpc: string | null;
  breaking_change_reason: string | null;
}

interface DriftAnalytics {
  entity_name: string;
  drift_type: string;
  is_critical: boolean;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  last_resolved_at: string | null;
  unresolved_count: number;
}

export default function SchemaDriftDashboard() {
  const [driftResult, setDriftResult] = useState<DriftResult | null>(null);
  const [contracts, setContracts] = useState<ContractSummary | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [recentDrifts, setRecentDrifts] = useState<any[]>([]);
  const [topDrifts, setTopDrifts] = useState<DriftAnalytics[]>([]);
  const [rpcVersions, setRpcVersions] = useState<RpcVersion[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [contractRes, ledgerRes, driftLogRes, analyticsRes, rpcRes] = await Promise.all([
        supabase.from('schema_contracts').select('contract_type, deprecated_at'),
        supabase.from('schema_version_ledger')
          .select('function_name, required_migration, verified_ok, last_verified_at')
          .order('function_name'),
        supabase.from('schema_drift_log').select('*').order('detected_at', { ascending: false }).limit(20),
        supabase.from('v_drift_analytics' as any).select('*').limit(15),
        supabase.from('rpc_version_registry' as any).select('*').order('rpc_name, version'),
      ]);

      if (contractRes.data) {
        const byType: Record<string, number> = {};
        let deprecated = 0;
        (contractRes.data as any[]).forEach((c: any) => {
          byType[c.contract_type] = (byType[c.contract_type] || 0) + 1;
          if (c.deprecated_at) deprecated++;
        });
        setContracts({ total: contractRes.data.length, active: contractRes.data.length - deprecated, deprecated, byType });
      }
      if (ledgerRes.data) setLedger(ledgerRes.data as unknown as LedgerEntry[]);
      if (driftLogRes.data) setRecentDrifts(driftLogRes.data);
      if (analyticsRes.data) setTopDrifts(analyticsRes.data as unknown as DriftAnalytics[]);
      if (rpcRes.data) setRpcVersions(rpcRes.data as unknown as RpcVersion[]);
    } catch (e) {
      console.error('Failed to load schema data', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const runDriftCheck = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('schema-health', {
        body: { source: 'dashboard' },
      });
      if (error) throw error;
      setDriftResult(data as DriftResult);
      toast.success(`Drift-Check abgeschlossen: ${data.drift_count} Abweichungen`);
      await loadData();
    } catch (e: any) {
      toast.error(`Drift-Check Fehler: ${e.message}`);
    }
    setRunning(false);
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.rpc('sync_schema_contracts' as any);
      if (error) throw error;
      const result = data as any;
      toast.success(`Contracts synced: ${result.updated} aktualisiert, ${result.deprecated} deprecated`);
      await loadData();
    } catch (e: any) {
      toast.error(`Sync Fehler: ${e.message}`);
    }
    setSyncing(false);
  };

  const driftTypeLabel: Record<string, string> = {
    missing_column: 'Fehlende Spalte',
    wrong_type: 'Falscher Typ',
    missing_rpc: 'Fehlende RPC',
    missing_rls_policy: 'Fehlende RLS-Policy',
    missing_view: 'Fehlende View',
    missing_table: 'Fehlende Tabelle',
  };

  const contractTypeLabel: Record<string, string> = {
    column: 'Spalten',
    rpc: 'RPCs',
    table: 'Tabellen',
    view: 'Views',
    rls_policy: 'RLS-Policies',
    enum: 'Enums',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Schema SSOT & Drift-Status</h2>
        </div>
        <div className="flex gap-2">
          <Button onClick={runSync} disabled={syncing} size="sm" variant="outline">
            <Database className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            Contracts synchen
          </Button>
          <Button onClick={runDriftCheck} disabled={running} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 mr-1 ${running ? 'animate-spin' : ''}`} />
            Drift-Check
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2">
              {driftResult?.ok !== false ? (
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              ) : (
                <ShieldAlert className="h-5 w-5 text-destructive" />
              )}
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="text-sm font-semibold">
                  {driftResult === null ? 'Nicht geprüft' : driftResult.ok ? 'Kein Drift ✓' : `${driftResult.critical_count} kritisch`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Contracts</p>
            <p className="text-xl font-bold">{contracts?.active || '–'}<span className="text-sm text-muted-foreground font-normal"> / {contracts?.total}</span></p>
            <div className="flex flex-wrap gap-1 mt-1">
              {contracts && Object.entries(contracts.byType).map(([type, count]) => (
                <Badge key={type} variant="secondary" className="text-[10px]">
                  {contractTypeLabel[type] || type}: {count}
                </Badge>
              ))}
              {contracts && contracts.deprecated > 0 && (
                <Badge variant="outline" className="text-[10px] text-yellow-600">
                  ⚠ {contracts.deprecated} deprecated
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Gated Functions</p>
            <p className="text-xl font-bold">{ledger.length}</p>
            <div className="flex gap-1 mt-1">
              <Badge variant="secondary" className="text-[10px]">
                ✅ {ledger.filter(l => l.verified_ok).length} OK
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                ⏳ {ledger.filter(l => !l.verified_ok).length} ausstehend
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Drift-Historie</p>
            <p className="text-xl font-bold">{recentDrifts.length}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {recentDrifts.filter(d => d.is_critical).length} kritisch, {recentDrifts.filter(d => d.resolved_at).length} behoben
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top Drift Entities (Analytics) */}
      {topDrifts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" />
              Top Drift-Entities (häufigste Abweichungen)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {topDrifts.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    {d.is_critical ? (
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                    )}
                    <Badge variant={d.is_critical ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                      {driftTypeLabel[d.drift_type] || d.drift_type}
                    </Badge>
                    <span className="font-mono text-xs truncate max-w-[200px]">{d.entity_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>{d.occurrence_count}× aufgetreten</span>
                    <span>seit {new Date(d.first_seen_at).toLocaleDateString('de-DE')}</span>
                    {d.unresolved_count > 0 && (
                      <Badge variant="destructive" className="text-[9px]">{d.unresolved_count} offen</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Drift Results */}
      {driftResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Letzter Drift-Check ({new Date(driftResult.checked_at).toLocaleString('de-DE')})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {driftResult.drifts.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-sm">Keine Abweichungen gefunden – Schema ist konsistent.</span>
              </div>
            ) : (
              <div className="space-y-1">
                {driftResult.drifts.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm py-1 border-b border-border last:border-0">
                    {d.critical ? (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                    )}
                    <Badge variant={d.critical ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                      {driftTypeLabel[d.type] || d.type}
                    </Badge>
                    <span className="font-mono text-xs">{d.entity}</span>
                    {d.expected && <span className="text-muted-foreground text-[10px]">erwartet: {JSON.stringify(d.expected)}</span>}
                    {d.actual && <span className="text-muted-foreground text-[10px]">ist: {d.actual}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* RPC Version Registry */}
      {rpcVersions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <GitBranch className="h-4 w-4" />
              RPC-Versionierung ({rpcVersions.filter(r => r.is_current).length} aktiv, {rpcVersions.filter(r => r.deprecated_at).length} deprecated)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {rpcVersions.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    {r.is_current ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-mono text-xs">{r.rpc_name}</span>
                    <Badge variant={r.is_current ? 'default' : 'secondary'} className="text-[10px]">
                      v{r.version}
                    </Badge>
                    {r.deprecated_at && (
                      <Badge variant="outline" className="text-[10px] text-yellow-600">deprecated</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    {r.successor_rpc && <span>→ {r.successor_rpc}</span>}
                    {r.breaking_change_reason && (
                      <span className="max-w-[250px] truncate" title={r.breaking_change_reason}>
                        {r.breaking_change_reason}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}


      {/* Ledger */}
      {ledger.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Schema-Version Ledger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {ledger.map(l => (
                <div key={l.function_name} className="flex items-center justify-between text-sm py-1 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    {l.verified_ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                    )}
                    <span className="font-mono text-xs">{l.function_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{l.required_migration}</span>
                    {l.last_verified_at && (
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(l.last_verified_at).toLocaleString('de-DE')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
