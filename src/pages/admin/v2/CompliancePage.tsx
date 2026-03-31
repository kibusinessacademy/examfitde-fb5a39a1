import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription
} from '@/components/ui/sheet';
import {
  Shield, FileCheck, Eye, Bot, Database,
  CheckCircle2, AlertTriangle, Clock, XCircle,
  ChevronDown, RefreshCw, Play, Loader2, Wrench,
  Search, FileWarning, Lock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';

/* ── Types ── */
interface Framework {
  id: string;
  framework_key: string;
  name: string;
  version: string;
  category: string;
  description: string;
  requirements_json: { id: string; title: string; description: string }[];
  is_active: boolean;
}

interface DsgvoRecord {
  id: string;
  process_name: string;
  process_purpose: string;
  data_categories: string[];
  data_subjects: string[];
  legal_basis: string;
  retention_period: string;
  risk_level: string;
  responsible_person: string;
  status: string;
}

interface AiReview {
  id: string;
  system_name: string;
  risk_category: string;
  eu_ai_act_class: string;
  purpose: string;
  models_used: string[];
  human_oversight_level: string;
  review_status: string;
  findings: Record<string, unknown> | null;
  remediation_plan: Record<string, unknown> | null;
  accuracy_metrics: Record<string, unknown> | null;
  bias_assessment: Record<string, unknown> | null;
  next_review_date: string | null;
}

interface IntegrityRow {
  package_id: string;
  package_title?: string;
  has_report: boolean;
  version_set: boolean;
  mismatch: boolean;
}

/* ── Hooks ── */
function useFrameworks() {
  return useQuery({
    queryKey: ['compliance-frameworks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('compliance_frameworks')
        .select('*')
        .eq('is_active', true)
        .order('category');
      if (error) throw error;
      return (data || []) as unknown as Framework[];
    },
    staleTime: 60_000,
  });
}

function useDsgvoRecords() {
  return useQuery({
    queryKey: ['dsgvo-records'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dsgvo_processing_records')
        .select('*')
        .order('process_name');
      if (error) throw error;
      return (data || []) as unknown as DsgvoRecord[];
    },
    staleTime: 60_000,
  });
}

function useAiReviews() {
  return useQuery({
    queryKey: ['ai-governance-reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_governance_reviews')
        .select('*')
        .order('risk_category');
      if (error) throw error;
      return (data || []) as unknown as AiReview[];
    },
    staleTime: 60_000,
  });
}

function useIntegrityAudit() {
  return useQuery({
    queryKey: ['compliance-integrity-audit'],
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('course_packages' as any)
          .select('id, title, integrity_report, integrity_report_version')
          .not('status', 'eq', 'archived')
          .limit(200);
        if (error) return [];
        return (data || []).map((p: any) => ({
          package_id: p.id,
          package_title: p.title || 'Unbenannt',
          has_report: !!p.integrity_report,
          version_set: !!p.integrity_report_version,
          mismatch: !!p.integrity_report_version && !p.integrity_report,
        })) as IntegrityRow[];
      } catch {
        return [];
      }
    },
    staleTime: 120_000,
  });
}

/* ── Components ── */

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    approved: { label: 'Freigegeben', cls: 'border-success/40 text-success bg-success/5' },
    in_review: { label: 'In Prüfung', cls: 'border-warning/40 text-warning bg-warning/5' },
    pending: { label: 'Ausstehend', cls: 'border-muted-foreground/40 text-muted-foreground bg-muted/30' },
    active: { label: 'Aktiv', cls: 'border-success/40 text-success bg-success/5' },
    completed: { label: 'Abgeschlossen', cls: 'border-success/40 text-success bg-success/5' },
  };
  const s = map[status] || { label: status, cls: 'border-border text-muted-foreground' };
  return <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", s.cls)}>{s.label}</Badge>;
}

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    high: { label: 'Hoch', cls: 'border-destructive/40 text-destructive bg-destructive/5', icon: <AlertTriangle className="h-3 w-3" /> },
    limited: { label: 'Begrenzt', cls: 'border-warning/40 text-warning bg-warning/5', icon: <Eye className="h-3 w-3" /> },
    minimal: { label: 'Minimal', cls: 'border-success/40 text-success bg-success/5', icon: <CheckCircle2 className="h-3 w-3" /> },
    normal: { label: 'Normal', cls: 'border-border text-muted-foreground', icon: <Shield className="h-3 w-3" /> },
    hoch: { label: 'Hoch', cls: 'border-destructive/40 text-destructive bg-destructive/5', icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const r = map[level] || map.normal!;
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 flex items-center gap-1", r.cls)}>
      {r.icon} {r.label}
    </Badge>
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  quality: <Shield className="h-4 w-4 text-primary" />,
  regulatory: <FileCheck className="h-4 w-4 text-warning" />,
  data_protection: <Database className="h-4 w-4 text-primary" />,
  ai_ethics: <Bot className="h-4 w-4 text-primary" />,
};

const CATEGORY_LABELS: Record<string, string> = {
  quality: 'Qualitätsmanagement',
  regulatory: 'Regulatorik',
  data_protection: 'Datenschutz',
  ai_ethics: 'KI-Governance',
};

function FrameworkCard({ fw }: { fw: Framework }) {
  const [open, setOpen] = useState(false);
  const reqs = fw.requirements_json || [];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="shrink-0 mt-0.5">
          {CATEGORY_ICONS[fw.category] || <Shield className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-foreground">{fw.name}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{fw.description}</div>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="outline" className="text-[9px] px-1 py-0">v{fw.version}</Badge>
            <span className="text-[10px] text-muted-foreground">{reqs.length} Anforderungen</span>
          </div>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform mt-1", open && "rotate-180")} />
      </button>
      {open && reqs.length > 0 && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
          {reqs.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
              <div>
                <div className="text-[11px] font-medium text-foreground">{r.id}: {r.title}</div>
                <div className="text-[10px] text-muted-foreground">{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── AI Review Detail Sheet ── */
function AiReviewSheet({ review, open, onOpenChange }: { review: AiReview | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();

  const triggerReview = useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from('ai_governance_reviews')
        .update({ review_status: 'in_review', updated_at: new Date().toISOString() })
        .eq('id', reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-governance-reviews'] });
      toast.success('Review gestartet');
    },
    onError: () => toast.error('Fehler beim Starten'),
  });

  const approveReview = useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from('ai_governance_reviews')
        .update({
          review_status: 'approved',
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-governance-reviews'] });
      toast.success('KI-System freigegeben');
      onOpenChange(false);
    },
    onError: () => toast.error('Fehler bei Freigabe'),
  });

  if (!review) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            {review.system_name}
          </SheetTitle>
          <SheetDescription>{review.purpose}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={review.review_status} />
            <RiskBadge level={review.risk_category} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">EU AI Act Klasse</div>
              <div className="text-sm font-medium text-foreground mt-0.5">{review.eu_ai_act_class || '—'}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Human Oversight</div>
              <div className="text-sm font-medium text-foreground mt-0.5">{review.human_oversight_level?.replace(/_/g, ' ') || '—'}</div>
            </div>
          </div>

          {review.models_used.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Verwendete Modelle</div>
              <div className="flex flex-wrap gap-1">
                {review.models_used.map((m, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0 font-mono">{m}</Badge>
                ))}
              </div>
            </div>
          )}

          {review.next_review_date && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-warning" />
              <span className="text-xs text-foreground">Nächste Prüfung: {new Date(review.next_review_date).toLocaleDateString('de-DE')}</span>
            </div>
          )}

          {review.findings && Object.keys(review.findings).length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Befunde</div>
              <pre className="text-[10px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-32 text-muted-foreground">
                {JSON.stringify(review.findings, null, 2)}
              </pre>
            </div>
          )}

          {review.remediation_plan && Object.keys(review.remediation_plan).length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-1">Maßnahmenplan</div>
              <pre className="text-[10px] bg-muted/50 rounded-lg p-2 overflow-x-auto max-h-32 text-muted-foreground">
                {JSON.stringify(review.remediation_plan, null, 2)}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {review.review_status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => triggerReview.mutate(review.id)}
                disabled={triggerReview.isPending}
              >
                {triggerReview.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Review starten
              </Button>
            )}
            {review.review_status === 'in_review' && (
              <Button
                size="sm"
                className="w-full"
                onClick={() => approveReview.mutate(review.id)}
                disabled={approveReview.isPending}
              >
                {approveReview.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Freigeben
              </Button>
            )}
            {review.risk_category === 'high' && review.review_status !== 'approved' && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
                <div className="text-[10px] text-destructive flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Hohes Risiko – erfordert dokumentierte menschliche Aufsicht gemäß EU AI Act Art. 14
                </div>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── DSGVO Detail Sheet ── */
function DsgvoSheet({ record, open, onOpenChange }: { record: DsgvoRecord | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('dsgvo_processing_records')
        .update({ status } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dsgvo-records'] });
      toast.success('Status aktualisiert');
    },
    onError: () => toast.error('Fehler'),
  });

  if (!record) return null;

  const isHighRisk = record.risk_level === 'hoch' || record.risk_level === 'high';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            {record.process_name}
          </SheetTitle>
          <SheetDescription>{record.process_purpose}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={record.status} />
            <RiskBadge level={record.risk_level} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Rechtsgrundlage</div>
              <div className="text-xs text-foreground mt-0.5">{record.legal_basis}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Aufbewahrung</div>
              <div className="text-xs text-foreground mt-0.5">{record.retention_period}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Betroffene</div>
              <div className="text-xs text-foreground mt-0.5">{record.data_subjects.join(', ')}</div>
            </div>
            <div className="rounded-lg border border-border p-2">
              <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Verantwortlich</div>
              <div className="text-xs text-foreground mt-0.5">{record.responsible_person}</div>
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-foreground mb-1">Datenkategorien</div>
            <div className="flex flex-wrap gap-1">
              {record.data_categories.map((cat, i) => (
                <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0">{cat}</Badge>
              ))}
            </div>
          </div>

          {isHighRisk && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2">
              <div className="text-[10px] text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Hohes Risiko – Datenschutz-Folgenabschätzung (DSFA) gemäß Art. 35 DSGVO erforderlich
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="border-t border-border pt-3 space-y-2">
            <div className="text-xs font-semibold text-foreground">Aktionen</div>
            {record.status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => updateStatus.mutate({ id: record.id, status: 'active' })}
                disabled={updateStatus.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Als aktiv markieren
              </Button>
            )}
            {record.status === 'active' && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => updateStatus.mutate({ id: record.id, status: 'completed' })}
                disabled={updateStatus.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Prüfung abschließen
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Integrity Audit Section ── */
function IntegrityAuditSection() {
  const { data: rows = [], isLoading } = useIntegrityAudit();
  const [expanded, setExpanded] = useState(false);

  const mismatches = rows.filter(r => r.mismatch);
  const withoutReport = rows.filter(r => !r.has_report && r.version_set);

  if (isLoading) return <Skeleton className="h-20" />;
  if (mismatches.length === 0 && withoutReport.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
        <FileWarning className="h-4 w-4 text-destructive" /> Integritäts-Audit
      </h2>
      {mismatches.length > 0 && (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 mb-2 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">{mismatches.length} Paket(e) mit Integritäts-Mismatch</div>
              <div className="text-[11px] text-muted-foreground">Version gesetzt, aber Report fehlt – Auto-Requeue durch Trigger erwartet</div>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          </div>
          {expanded && (
            <div className="mt-2 space-y-1 border-t border-destructive/20 pt-2">
              {mismatches.slice(0, 10).map(r => (
                <div key={r.package_id} className="text-[11px] text-foreground flex items-center gap-2">
                  <Lock className="h-3 w-3 text-destructive" />
                  <span className="font-mono">{r.package_id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{r.package_title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function CompliancePage() {
  const qc = useQueryClient();
  const { data: frameworks, isLoading: fwLoading } = useFrameworks();
  const { data: dsgvo, isLoading: dsLoading } = useDsgvoRecords();
  const { data: aiReviews, isLoading: aiLoading } = useAiReviews();

  const [selectedAiReview, setSelectedAiReview] = useState<AiReview | null>(null);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [selectedDsgvo, setSelectedDsgvo] = useState<DsgvoRecord | null>(null);
  const [dsgvoSheetOpen, setDsgvoSheetOpen] = useState(false);

  const isLoading = fwLoading || dsLoading || aiLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  const grouped = (frameworks || []).reduce<Record<string, Framework[]>>((acc, fw) => {
    (acc[fw.category] = acc[fw.category] || []).push(fw);
    return acc;
  }, {});

  const aiPending = aiReviews?.filter(r => r.review_status === 'pending' || r.review_status === 'in_review') || [];
  const dsgvoHighRisk = dsgvo?.filter(r => r.risk_level === 'hoch' || r.risk_level === 'high') || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Compliance & Governance</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            AZAV · ZFU · DSGVO · AI Governance · Echtdaten
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['compliance-frameworks'] });
            qc.invalidateQueries({ queryKey: ['dsgvo-records'] });
            qc.invalidateQueries({ queryKey: ['ai-governance-reviews'] });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Aktualisieren
        </Button>
      </div>

      {/* KPI Overview – now clickable */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{frameworks?.length || 0}</div>
          <div className="text-[11px] text-muted-foreground">Frameworks aktiv</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{dsgvo?.length || 0}</div>
          <div className="text-[11px] text-muted-foreground">DSGVO-Verzeichnisse</div>
        </div>
        <div
          className={cn(
            "rounded-xl border p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all",
            aiReviews?.filter(r => r.review_status === 'approved').length === aiReviews?.length
              ? "border-success/30 bg-success/5"
              : "border-border bg-card"
          )}
        >
          <div className="text-lg font-bold text-foreground">{aiReviews?.filter(r => r.review_status === 'approved').length || 0}</div>
          <div className="text-[11px] text-muted-foreground">KI-Systeme freigegeben</div>
        </div>
        <div
          className={cn(
            "rounded-xl border p-3 cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all",
            aiPending.length > 0 ? "border-warning/30 bg-warning/5" : "border-border bg-card"
          )}
        >
          <div className="text-lg font-bold text-foreground">{aiPending.length}</div>
          <div className="text-[11px] text-muted-foreground">KI-Reviews offen</div>
        </div>
      </div>

      {/* Alert Banners */}
      {aiPending.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">{aiPending.length} KI-System(e) warten auf Review</div>
            <div className="text-[11px] text-muted-foreground">EU AI Act Compliance erfordert regelmäßige Prüfung aller KI-Systeme.</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {aiPending.map(r => (
                <Button
                  key={r.id}
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={() => { setSelectedAiReview(r); setAiSheetOpen(true); }}
                >
                  <Search className="h-3 w-3 mr-1" />
                  {r.system_name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {dsgvoHighRisk.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-3">
          <Lock className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">{dsgvoHighRisk.length} Verarbeitungsprozess(e) mit hohem Risiko</div>
            <div className="text-[11px] text-muted-foreground">DSFA gemäß Art. 35 DSGVO prüfen.</div>
            <div className="flex flex-wrap gap-1 mt-2">
              {dsgvoHighRisk.map(r => (
                <Button
                  key={r.id}
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={() => { setSelectedDsgvo(r); setDsgvoSheetOpen(true); }}
                >
                  <Search className="h-3 w-3 mr-1" />
                  {r.process_name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Integrity Audit */}
      <IntegrityAuditSection />

      {/* Frameworks by Category */}
      {Object.entries(grouped).map(([cat, fws]) => (
        <div key={cat}>
          <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat] || cat}
          </h2>
          <div className="grid gap-2">
            {fws.map(fw => <FrameworkCard key={fw.id} fw={fw} />)}
          </div>
        </div>
      ))}

      {/* DSGVO Verarbeitungsverzeichnis */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" /> DSGVO Verarbeitungsverzeichnis (Art. 30)
        </h2>
        <div className="space-y-2">
          {(dsgvo || []).map(rec => (
            <div
              key={rec.id}
              className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => { setSelectedDsgvo(rec); setDsgvoSheetOpen(true); }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{rec.process_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{rec.process_purpose}</div>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge status={rec.status} />
                  <RiskBadge level={rec.risk_level} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Rechtsgrundlage</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rec.legal_basis}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Aufbewahrung</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rec.retention_period}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Governance Reviews */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" /> AI Governance (EU AI Act)
        </h2>
        <div className="space-y-2">
          {(aiReviews || []).map(rev => (
            <div
              key={rev.id}
              className="rounded-xl border border-border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => { setSelectedAiReview(rev); setAiSheetOpen(true); }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{rev.system_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{rev.purpose}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={rev.review_status} />
                  <RiskBadge level={rev.risk_category} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">EU AI Act Klasse</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rev.eu_ai_act_class || '—'}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Human Oversight</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rev.human_oversight_level?.replace(/_/g, ' ') || '—'}</div>
                </div>
              </div>
              {rev.models_used.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {rev.models_used.map((m, i) => (
                    <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 font-mono">{m}</Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Sheets */}
      <AiReviewSheet review={selectedAiReview} open={aiSheetOpen} onOpenChange={setAiSheetOpen} />
      <DsgvoSheet record={selectedDsgvo} open={dsgvoSheetOpen} onOpenChange={setDsgvoSheetOpen} />
    </div>
  );
}
