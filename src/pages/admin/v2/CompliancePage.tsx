import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Shield, FileCheck, Eye, Bot, Database,
  CheckCircle2, AlertTriangle, Clock, XCircle,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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
      return (data || []) as Framework[];
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
      return (data || []) as DsgvoRecord[];
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
      return (data || []) as AiReview[];
    },
    staleTime: 60_000,
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
  data_protection: <Database className="h-4 w-4 text-blue-500" />,
  ai_ethics: <Bot className="h-4 w-4 text-purple-500" />,
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

/* ── Main Page ── */
export default function CompliancePage() {
  const { data: frameworks, isLoading: fwLoading } = useFrameworks();
  const { data: dsgvo, isLoading: dsLoading } = useDsgvoRecords();
  const { data: aiReviews, isLoading: aiLoading } = useAiReviews();

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Compliance & Governance</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          AZAV · ZFU · DSGVO · AI Governance · Echtdaten
        </p>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{frameworks?.length || 0}</div>
          <div className="text-[11px] text-muted-foreground">Frameworks aktiv</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{dsgvo?.length || 0}</div>
          <div className="text-[11px] text-muted-foreground">DSGVO-Verzeichnisse</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{aiReviews?.filter(r => r.review_status === 'approved').length || 0}</div>
          <div className="text-[11px] text-muted-foreground">KI-Systeme freigegeben</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-lg font-bold text-foreground">{aiReviews?.filter(r => r.review_status === 'in_review').length || 0}</div>
          <div className="text-[11px] text-muted-foreground">KI-Reviews offen</div>
        </div>
      </div>

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
          <Database className="h-4 w-4 text-blue-500" /> DSGVO Verarbeitungsverzeichnis (Art. 30)
        </h2>
        <div className="space-y-2">
          {(dsgvo || []).map(rec => (
            <div key={rec.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-foreground">{rec.process_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{rec.process_purpose}</div>
                </div>
                <RiskBadge level={rec.risk_level} />
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
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Betroffene</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rec.data_subjects.join(', ')}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground uppercase tracking-wider">Verantwortlich</div>
                  <div className="text-[10px] text-foreground mt-0.5">{rec.responsible_person}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {rec.data_categories.map((cat, i) => (
                  <Badge key={i} variant="outline" className="text-[9px] px-1 py-0">{cat}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Governance Reviews */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Bot className="h-4 w-4 text-purple-500" /> AI Governance (EU AI Act)
        </h2>
        <div className="space-y-2">
          {(aiReviews || []).map(rev => (
            <div key={rev.id} className="rounded-xl border border-border bg-card p-3">
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
                  <div className="text-[10px] text-foreground mt-0.5">{rev.human_oversight_level.replace(/_/g, ' ')}</div>
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
    </div>
  );
}
