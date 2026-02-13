import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import {
  Loader2, Upload, Play, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, FileText, Link as LinkIcon, MapPin, Shield,
  ChevronDown, ChevronRight, Target
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/* ─── Types ─── */
interface CertDoc {
  id: string;
  certification_id: string;
  doc_type: string;
  source_kind: string;
  source_url: string | null;
  storage_path: string | null;
  version_label: string | null;
  legal_priority: number;
  status: string;
  created_at: string;
}

interface IngestRun {
  id: string;
  document_id: string;
  run_type: string;
  status: string;
  error: string | null;
  metrics: any;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface CoverageSnapshot {
  id: string;
  overall_coverage: number;
  by_domain: Record<string, { total: number; mapped: number; coverage: number }>;
  missing_topics: Array<{ topic_id: string; topic_name: string; topic_code: string }>;
  gate_status: string;
  created_at: string;
}

interface TopicCoverage {
  id: string;
  topic_id: string;
  blueprint_domain_key: string | null;
  mapped: boolean;
  confidence: number | null;
  topic: { id: string; topic_name: string; topic_code: string | null };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  verordnung: '📜 Verordnung',
  rahmenplan: '📋 Rahmenplan',
  pruefungsordnung: '📝 Prüfungsordnung',
  strukturinfo: '🏗 Strukturinfo',
  sonstiges: '📎 Sonstiges',
};

const GATE_COLORS: Record<string, string> = {
  passed: 'bg-success/20 text-success',
  failed: 'bg-destructive/20 text-destructive',
  pending: 'bg-muted text-muted-foreground',
  hold: 'bg-warning/20 text-warning',
};

/* ─── Certification Selector ─── */
function CertSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [certs, setCerts] = useState<any[]>([]);
  useEffect(() => {
    (supabase as any).from('german_certification_master')
      .select('id, name').order('name').then(({ data }: any) => setCerts(data || []));
  }, []);
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm h-9 rounded-md border border-border bg-background px-3 w-full max-w-md">
      <option value="">Zertifizierung wählen…</option>
      {certs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

/* ─── Documents Panel ─── */
function DocumentsPanel({ certId, docs, onRefresh }: { certId: string; docs: CertDoc[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newDocType, setNewDocType] = useState('rahmenplan');

  const handleAddUrl = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    const { error } = await (supabase as any).rpc('register_cert_document', {
      p_certification_id: certId,
      p_doc_type: newDocType,
      p_source_kind: 'url',
      p_source_url: newUrl.trim(),
      p_legal_priority: newDocType === 'verordnung' ? 100 : 80,
    });
    if (error) toast.error(error.message);
    else { toast.success('Dokument registriert'); setNewUrl(''); onRefresh(); }
    setAdding(false);
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Quelldokumente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {docs.map(d => (
          <div key={d.id} className="flex items-center gap-2 p-2 rounded border border-border text-sm">
            <Badge variant="outline" className="text-[10px]">{DOC_TYPE_LABELS[d.doc_type] || d.doc_type}</Badge>
            <span className="flex-1 truncate text-muted-foreground">
              {d.source_url || d.storage_path || 'Kein Pfad'}
            </span>
            <Badge variant="outline" className={cn("text-[10px]",
              d.status === 'active' ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'
            )}>{d.status}</Badge>
            {d.version_label && <span className="text-[10px] text-muted-foreground">{d.version_label}</span>}
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <select value={newDocType} onChange={e => setNewDocType(e.target.value)}
            className="text-xs h-8 rounded border border-border bg-background px-2">
            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Input placeholder="URL eingeben…" value={newUrl} onChange={e => setNewUrl(e.target.value)}
            className="h-8 text-sm flex-1" />
          <Button size="sm" className="h-8" onClick={handleAddUrl} disabled={adding || !newUrl.trim()}>
            <LinkIcon className="h-3 w-3 mr-1" /> Hinzufügen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Ingest Runs Panel ─── */
function IngestRunsPanel({ certId, docs, runs, onRefresh }: { certId: string; docs: CertDoc[]; runs: IngestRun[]; onRefresh: () => void }) {
  const [ingesting, setIngesting] = useState<string | null>(null);

  const startIngest = async (docId: string) => {
    setIngesting(docId);
    try {
      const { data: runId, error: rpcErr } = await (supabase as any).rpc('start_curriculum_ingest', { p_document_id: docId });
      if (rpcErr) throw rpcErr;
      toast.info('Ingest gestartet…');
      const { error } = await supabase.functions.invoke('ingest-curriculum-document', {
        body: { document_id: docId, run_id: runId },
      });
      if (error) throw error;
      toast.success('Ingest abgeschlossen');
      onRefresh();
    } catch (err: any) {
      toast.error(`Fehler: ${err.message}`);
    } finally {
      setIngesting(null);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2"><Play className="h-4 w-4" /> Ingest-Runs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Start buttons per active doc */}
        <div className="flex flex-wrap gap-2">
          {docs.filter(d => d.status === 'active').map(d => (
            <Button key={d.id} size="sm" variant="outline" className="text-xs h-7"
              disabled={!!ingesting} onClick={() => startIngest(d.id)}>
              {ingesting === d.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {DOC_TYPE_LABELS[d.doc_type]} ingestieren
            </Button>
          ))}
          {docs.filter(d => d.status === 'active').length === 0 && (
            <p className="text-xs text-muted-foreground">Keine aktiven Dokumente. Füge eine URL hinzu.</p>
          )}
        </div>
        {/* Run history */}
        {runs.map(r => (
          <div key={r.id} className="flex items-center gap-2 p-2 rounded border border-border text-xs">
            <Badge variant="outline" className={cn("text-[10px]",
              r.status === 'success' ? 'bg-success/20 text-success' :
              r.status === 'failed' ? 'bg-destructive/20 text-destructive' :
              r.status === 'running' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}>{r.status}</Badge>
            <span className="text-muted-foreground">{r.run_type}</span>
            {r.metrics?.extracted_topics_count && (
              <span className="text-foreground font-mono">{r.metrics.extracted_topics_count} Topics</span>
            )}
            {r.error && <span className="text-destructive truncate max-w-48">{r.error}</span>}
            <span className="ml-auto text-muted-foreground">{new Date(r.created_at).toLocaleString('de')}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── Coverage Dashboard ─── */
function CoverageDashboard({ certId, snapshot, onAutoMap }: {
  certId: string;
  snapshot: CoverageSnapshot | null;
  onAutoMap: () => void;
}) {
  if (!snapshot) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Noch keine Coverage-Daten. Starte einen Ingest.
        </CardContent>
      </Card>
    );
  }

  const pct = Math.round(snapshot.overall_coverage * 100);
  const gateColor = GATE_COLORS[snapshot.gate_status] || GATE_COLORS.pending;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Coverage</CardTitle>
          <Badge variant="outline" className={cn("text-xs", gateColor)}>
            {snapshot.gate_status === 'passed' ? '✅ Gate OK' :
             snapshot.gate_status === 'failed' ? '🚫 < 90%' : snapshot.gate_status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall gauge */}
        <div className="text-center">
          <p className={cn("text-4xl font-bold", pct >= 95 ? 'text-success' : pct >= 90 ? 'text-warning' : 'text-destructive')}>
            {pct}%
          </p>
          <p className="text-xs text-muted-foreground mt-1">Rahmenplan Coverage (Ziel: ≥95%)</p>
          <Progress value={pct} className="h-2 mt-2" />
        </div>

        {/* By domain */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pro Domain</p>
          {Object.entries(snapshot.by_domain || {}).map(([key, val]) => {
            const domPct = Math.round((val.coverage || 0) * 100);
            return (
              <div key={key} className="flex items-center gap-2 text-xs">
                <span className="w-32 truncate text-foreground">{key}</span>
                <Progress value={domPct} className="h-1.5 flex-1" />
                <span className={cn("font-mono w-10 text-right",
                  domPct >= 90 ? 'text-success' : 'text-destructive'
                )}>{domPct}%</span>
                <span className="text-muted-foreground w-16">{val.mapped}/{val.total}</span>
              </div>
            );
          })}
        </div>

        {/* Missing topics */}
        {(snapshot.missing_topics || []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-destructive">
              {snapshot.missing_topics.length} fehlende Topics
            </p>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {snapshot.missing_topics.slice(0, 20).map((t: any) => (
                <p key={t.topic_id} className="text-[10px] text-muted-foreground">
                  {t.topic_code && <span className="font-mono mr-1">{t.topic_code}</span>}
                  {t.topic_name}
                </p>
              ))}
              {snapshot.missing_topics.length > 20 && (
                <p className="text-[10px] text-muted-foreground">… und {snapshot.missing_topics.length - 20} weitere</p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <Button size="sm" variant="outline" onClick={onAutoMap} className="w-full">
          <MapPin className="h-3.5 w-3.5 mr-1" /> Auto-Mapping starten
        </Button>
      </CardContent>
    </Card>
  );
}

/* ─── Main Page ─── */
export default function CurriculumIngestPage() {
  const [certId, setCertId] = useState('c09b2c12-0c63-4d76-9544-4e1062eb59b6'); // Wirtschaftsfachwirt default
  const [docs, setDocs] = useState<CertDoc[]>([]);
  const [runs, setRuns] = useState<IngestRun[]>([]);
  const [snapshot, setSnapshot] = useState<CoverageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapping, setMapping] = useState(false);

  const load = useCallback(async () => {
    if (!certId) { setLoading(false); return; }
    setLoading(true);
    const [docRes, runRes, snapRes] = await Promise.all([
      (supabase as any).from('certification_documents').select('*').eq('certification_id', certId).order('legal_priority', { ascending: false }),
      (supabase as any).from('curriculum_ingest_runs').select('*').eq('certification_id', certId).order('created_at', { ascending: false }).limit(20),
      (supabase as any).from('coverage_snapshots').select('*').eq('certification_id', certId).order('created_at', { ascending: false }).limit(1),
    ]);
    setDocs(docRes.data || []);
    setRuns(runRes.data || []);
    setSnapshot(snapRes.data?.[0] || null);
    setLoading(false);
  }, [certId]);

  useEffect(() => { load(); }, [load]);

  const handleAutoMap = async () => {
    setMapping(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-map-topics-to-blueprint', {
        body: { certification_id: certId },
      });
      if (error) throw error;
      toast.success(`${data.mapped} Topics gemappt, ${data.unsure} unsicher`);
      load();
    } catch (err: any) {
      toast.error(`Mapping-Fehler: ${err.message}`);
    } finally {
      setMapping(false);
    }
  };

  const handleRecomputeCoverage = async () => {
    try {
      const { data, error } = await (supabase as any).rpc('compute_curriculum_coverage', { p_certification_id: certId });
      if (error) throw error;
      toast.success(`Coverage: ${Math.round((data.overall_coverage || 0) * 100)}%`);
      load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Rahmenplan-Ingest & Coverage</h2>
          <p className="text-xs text-muted-foreground">Quellen registrieren → Ingest → Auto-Map → Coverage ≥90%</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleRecomputeCoverage}><Target className="h-3.5 w-3.5 mr-1" /> Coverage neu berechnen</Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <CertSelector value={certId} onChange={setCertId} />

      {certId && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Docs + Runs */}
          <div className="lg:col-span-2 space-y-4">
            <DocumentsPanel certId={certId} docs={docs} onRefresh={load} />
            <IngestRunsPanel certId={certId} docs={docs} runs={runs} onRefresh={load} />

            {/* Quick guide */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">📖 Anleitung</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p><strong>1.</strong> Zertifizierung wählen (z.B. Wirtschaftsfachwirt IHK)</p>
                <p><strong>2.</strong> Quelldokument hinzufügen (URL zum Rahmenplan oder Verordnung)</p>
                <p><strong>3.</strong> „Ingestieren" klicken → AI extrahiert Topics automatisch</p>
                <p><strong>4.</strong> „Auto-Mapping starten" → Topics werden Blueprint-Domains zugeordnet</p>
                <p><strong>5.</strong> Coverage ≥90% → Exam-Generierung wird freigeschaltet</p>
                <p className="pt-1 text-destructive font-medium">⚠️ Coverage &lt;90% = Exam-Generierung blockiert (Hold)</p>
              </CardContent>
            </Card>
          </div>

          {/* Right: Coverage */}
          <div>
            <CoverageDashboard certId={certId} snapshot={snapshot} onAutoMap={handleAutoMap} />
            {mapping && (
              <div className="flex items-center justify-center py-4 gap-2 text-sm text-primary">
                <Loader2 className="h-4 w-4 animate-spin" /> Auto-Mapping läuft…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
