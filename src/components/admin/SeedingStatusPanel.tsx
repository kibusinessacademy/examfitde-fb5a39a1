import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Sprout, AlertTriangle, CheckCircle2, Loader2, RefreshCw,
  ChevronDown, ChevronRight, Layers, BookOpen, Brain, Eye,
  Shield, Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SeedingSummary {
  package_id: string;
  certification_id: string;
  package_title: string;
  package_status: string;
  curriculum_title: string;
  curriculum_status: string;
  learning_field_count: number;
  competency_count: number;
  lesson_count: number;
  seed_status: 'missing' | 'partial' | 'ready';
  seed_reasons: string[];
}

const STATUS_CONFIG = {
  missing: { label: 'Fehlt', color: 'bg-destructive/10 text-destructive border-destructive/30', icon: AlertTriangle, emoji: '🔴' },
  partial: { label: 'Unvollständig', color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30', icon: Layers, emoji: '🟡' },
  ready: { label: 'Bereit', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', icon: CheckCircle2, emoji: '🟢' },
};

const REASON_LABELS: Record<string, string> = {
  curriculum_not_found: 'Curriculum fehlt komplett',
  curriculum_not_frozen: 'Curriculum nicht eingefroren',
  no_learning_fields: 'Keine Lernfelder vorhanden',
  few_learning_fields: 'Zu wenige Lernfelder (< 5)',
  no_competencies: 'Keine Kompetenzen vorhanden',
  few_competencies: 'Zu wenige Kompetenzen (< 10)',
  no_topics: 'Keine Topics vorhanden',
  few_topics: 'Zu wenige Topics (< 25)',
};

const REASON_CRITICALITY: Record<string, string> = {
  curriculum_not_found: 'Build, Exam, Handbook – alles blockiert',
  curriculum_not_frozen: 'Inkonsistente Datengrundlage möglich',
  no_learning_fields: 'Exam-Generator & Kursstruktur unmöglich',
  few_learning_fields: 'Unvollständige Prüfungsabdeckung',
  no_competencies: 'Kein Kompetenz-Mapping für Lessons/Exams',
  few_competencies: 'Lückenhafte Kompetenzabdeckung',
  no_topics: 'Keine Themenstruktur für Inhalte',
  few_topics: 'Unvollständige Themenabdeckung',
};

function useSeedingSummary() {
  return useQuery({
    queryKey: ['ops-seeding-summary'],
    queryFn: async (): Promise<SeedingSummary[]> => {
      const { data, error } = await (supabase as any)
        .from('ops_seeding_summary')
        .select('*')
        .order('seed_status', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });
}

function useSeedAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { certification_id: string; mode: string }) => {
      const { error } = await (supabase as any).from('job_queue').insert({
        job_type: 'batch_curriculum_pipeline',
        status: 'pending',
        payload: {
          curriculum_id: params.certification_id,
          mode: params.mode,
        },
        max_attempts: 3,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Seeding-Job enqueued');
      queryClient.invalidateQueries({ queryKey: ['ops-seeding-summary'] });
    },
    onError: (e: Error) => {
      toast.error(`Fehler: ${e.message}`);
    },
  });
}

export default function SeedingStatusPanel() {
  const { data: items, isLoading, refetch } = useSeedingSummary();
  const seedAction = useSeedAction();

  if (isLoading) return <Skeleton className="h-48" />;
  if (!items || items.length === 0) return null;

  const missing = items.filter(i => i.seed_status === 'missing');
  const partial = items.filter(i => i.seed_status === 'partial');
  const ready = items.filter(i => i.seed_status === 'ready');
  const notReady = [...missing, ...partial];

  const readyPct = items.length > 0 ? Math.round((ready.length / items.length) * 100) : 0;

  const handleSeedAll = () => {
    notReady.forEach(item => {
      seedAction.mutate({ certification_id: item.certification_id, mode: 'safe' });
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sprout className="h-4 w-4 text-emerald-500" />
            Phase 0: Seeding Gate
            {notReady.length > 0 && (
              <Badge variant="destructive" className="text-[9px]">
                {notReady.length} blockiert
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {notReady.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleSeedAll}
                disabled={seedAction.isPending}
              >
                {seedAction.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                Alle seeden
              </Button>
            )}
            <Badge variant="outline" className="text-[10px]">
              {ready.length}/{items.length} ready
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-2 rounded-lg bg-destructive/5 text-center">
            <p className="text-lg font-bold text-destructive">{missing.length}</p>
            <p className="text-[10px] text-muted-foreground">Missing</p>
          </div>
          <div className="p-2 rounded-lg bg-yellow-500/5 text-center">
            <p className="text-lg font-bold text-yellow-600">{partial.length}</p>
            <p className="text-[10px] text-muted-foreground">Partial</p>
          </div>
          <div className="p-2 rounded-lg bg-emerald-500/5 text-center">
            <p className="text-lg font-bold text-emerald-600">{ready.length}</p>
            <p className="text-[10px] text-muted-foreground">Ready</p>
          </div>
        </div>

        <Progress value={readyPct} className="h-2" />

        {/* Pipeline Gate Info */}
        {notReady.length > 0 && (
          <div className="flex items-center gap-2 p-2 rounded bg-destructive/5 text-xs text-destructive">
            <Shield className="h-3.5 w-3.5 shrink-0" />
            Build, Gap-Closer und Publish sind blockiert bis alle Pakete „ready" sind.
          </div>
        )}

        {/* Not-ready items (expanded) */}
        {notReady.length > 0 && (
          <div className="space-y-2">
            {notReady.map(item => (
              <SeedingItem key={item.package_id} item={item} onSeed={seedAction} />
            ))}
          </div>
        )}

        {/* Ready items (collapsed) */}
        {ready.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
              <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
              {ready.length} Pakete bereit für Build
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 mt-2">
              {ready.map(item => (
                <div key={item.package_id} className="flex items-center gap-2 py-1.5 px-3 rounded bg-emerald-500/5 text-xs">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                  <span className="font-medium text-foreground truncate">{item.package_title}</span>
                  <span className="text-muted-foreground ml-auto shrink-0">
                    {item.learning_field_count} LF · {item.competency_count} Komp · {item.lesson_count} Lekt
                  </span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function SeedingItem({ item, onSeed }: { item: SeedingSummary; onSeed: ReturnType<typeof useSeedAction> }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[item.seed_status];
  const StatusIcon = cfg.icon;

  return (
    <div className={cn("rounded-lg border p-3", cfg.color)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="text-sm font-semibold text-foreground truncate">{item.package_title}</span>
            <Badge variant="outline" className="text-[9px]">{cfg.emoji} {cfg.label}</Badge>
          </div>
          <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <BookOpen className="h-2.5 w-2.5" /> {item.learning_field_count} Lernfelder
            </span>
            <span className="flex items-center gap-1">
              <Brain className="h-2.5 w-2.5" /> {item.competency_count} Kompetenzen
            </span>
            <span className="flex items-center gap-1">
              <Layers className="h-2.5 w-2.5" /> {item.lesson_count} Lektionen
            </span>
          </div>

          {/* Reasons with criticality */}
          {item.seed_reasons && item.seed_reasons.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.seed_reasons.map(r => (
                <Badge key={r} variant="outline" className="text-[9px] bg-background/50" title={REASON_CRITICALITY[r] || ''}>
                  {REASON_LABELS[r] || r}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-1 shrink-0">
          {item.seed_status !== 'ready' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onSeed.mutate({ certification_id: item.certification_id, mode: 'safe' })}
              disabled={onSeed.isPending}
            >
              {onSeed.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sprout className="h-3 w-3 mr-1" />}
              Seed jetzt
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
            <Link to={`/admin/studio/${item.package_id}`}>
              <Eye className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Level 3: Detail view */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50 text-xs space-y-3">
          <div>
            <p className="font-medium text-foreground">Curriculum: {item.curriculum_title || '–'}</p>
            <p className="text-muted-foreground">Status: {item.curriculum_status || '–'}</p>
          </div>

          {/* Why is this critical? */}
          {item.seed_reasons && item.seed_reasons.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-medium text-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Warum ist das kritisch?
              </p>
              {item.seed_reasons.map(r => (
                <div key={r} className="pl-4 text-muted-foreground">
                  • {REASON_LABELS[r] || r}: <span className="text-foreground">{REASON_CRITICALITY[r] || 'Pipeline blockiert'}</span>
                </div>
              ))}
            </div>
          )}

          {/* Granular seed buttons */}
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => onSeed.mutate({ certification_id: item.certification_id, mode: 'learning_fields' })}
              disabled={onSeed.isPending}
            >
              <BookOpen className="h-2.5 w-2.5 mr-1" /> Seed Lernfelder
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => onSeed.mutate({ certification_id: item.certification_id, mode: 'competencies' })}
              disabled={onSeed.isPending}
            >
              <Brain className="h-2.5 w-2.5 mr-1" /> Seed Kompetenzen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => onSeed.mutate({ certification_id: item.certification_id, mode: 'full' })}
              disabled={onSeed.isPending}
            >
              <Zap className="h-2.5 w-2.5 mr-1" /> Full Reseed
            </Button>
          </div>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        {expanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
        {expanded ? 'Weniger' : 'Details & Einzel-Seeds'}
      </button>
    </div>
  );
}
