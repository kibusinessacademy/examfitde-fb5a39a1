import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  Settings2,
  Shield,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { useState } from 'react';

interface PolicyConfig {
  id: string;
  policy_key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  threshold_minutes: number;
  max_per_run: number;
  cooldown_minutes: number;
  last_run_at: string | null;
  last_run_result: Record<string, unknown> | null;
  updated_at: string;
  // Safety Rails
  dry_run: boolean;
  max_per_hour: number | null;
  max_per_day: number | null;
  escalate_instead: boolean;
  blacklist_ids: string[];
  severity: string;
}

const POLICY_ICONS: Record<string, React.ReactNode> = {
  requeue_transient_failed: <Zap className="h-4 w-4 text-amber-500" />,
  release_expired_cooldowns: <Clock className="h-4 w-4 text-primary" />,
  reset_stuck_steps: <AlertTriangle className="h-4 w-4 text-destructive" />,
  cancel_zombies: <Shield className="h-4 w-4 text-muted-foreground" />,
  flag_seo_gaps: <Settings2 className="h-4 w-4 text-primary" />,
  archive_stale_drafts: <Clock className="h-4 w-4 text-muted-foreground" />,
  fix_broken_redirects: <AlertTriangle className="h-4 w-4 text-amber-500" />,
};

const CRITICAL_POLICIES = new Set(['cancel_zombies', 'requeue_transient_failed', 'reset_stuck_steps']);

export function PolicyCenter() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['auto-heal-policies'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('auto_heal_config')
        .select('*')
        .order('policy_key');
      if (error) throw error;
      return (data ?? []) as PolicyConfig[];
    },
    refetchInterval: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from('auto_heal_config')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auto-heal-policies'] });
      toast({ title: 'Policy aktualisiert' });
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (patch: { id: string; threshold_minutes?: number; max_per_run?: number; cooldown_minutes?: number; dry_run?: boolean; max_per_hour?: number | null; max_per_day?: number | null; escalate_instead?: boolean }) => {
      const { id, ...fields } = patch;
      const { error } = await (supabase as any)
        .from('auto_heal_config')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auto-heal-policies'] });
      toast({ title: 'Policy gespeichert' });
      setEditingId(null);
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
    },
  });

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('auto-heal-runner');
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      const total = (res?.results || []).reduce((s: number, r: any) => s + (r.updated || 0), 0);
      toast({ title: 'Auto-Heal ausgeführt', description: `${total} Eingriffe durchgeführt.` });
      qc.invalidateQueries({ queryKey: ['auto-heal-policies'] });
      qc.invalidateQueries({ queryKey: ['leitstelle-recent-actions'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Auto-Heal fehlgeschlagen', description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <Card className="border-border/70 bg-card/70">
        <CardContent className="p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Auto-Heal Policies
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
          >
            {triggerMutation.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-2 h-3.5 w-3.5" />
            )}
            Jetzt ausführen
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(() => {
          const disabledCritical = policies.filter(p => CRITICAL_POLICIES.has(p.policy_key) && !p.enabled);
          if (disabledCritical.length > 0) {
            return (
              <div className="rounded-lg border border-destructive/40 bg-destructive-bg-subtle p-3 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-destructive">
                    {disabledCritical.length} kritische {disabledCritical.length === 1 ? 'Policy' : 'Policies'} deaktiviert
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {disabledCritical.map(p => p.label).join(', ')} — Pipeline-Recovery eingeschränkt.
                  </p>
                </div>
              </div>
            );
          }
          return (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-[11px] text-primary">Alle kritischen Policies aktiv — Self-Healing vollständig.</p>
            </div>
          );
        })()}
        {policies.map((p) => {
          const isEditing = editingId === p.id;
          const lastResult = p.last_run_result as any;
          const lastUpdated = lastResult?.updated;
          const isCritical = CRITICAL_POLICIES.has(p.policy_key);

          return (
            <div
              key={p.id}
              className={cn(
                'rounded-xl border p-4 transition-colors',
                p.enabled ? 'border-primary/20 bg-primary/5' : isCritical ? 'border-destructive/40 bg-destructive-bg-subtle' : 'border-border/60 bg-card/50',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5">
                    {POLICY_ICONS[p.policy_key] || <Settings2 className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{p.label}</span>
                      {isCritical && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-destructive/50 text-destructive">KRITISCH</Badge>
                      )}
                      {p.enabled && (
                        <Badge variant="default" className="text-[10px] h-5 px-1.5">aktiv</Badge>
                      )}
                      {isCritical && !p.enabled && (
                        <Badge variant="destructive" className="text-[10px] h-5 px-1.5 animate-pulse">DEAKTIVIERT</Badge>
                      )}
                    </div>
                    {p.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                      <span>Schwelle: {p.threshold_minutes} Min</span>
                      <span>Max: {p.max_per_run}/Lauf</span>
                      <span>Cooldown: {p.cooldown_minutes} Min</span>
                      {p.max_per_hour && <span>Max/h: {p.max_per_hour}</span>}
                      {p.max_per_day && <span>Max/d: {p.max_per_day}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {p.dry_run && <Badge variant="outline" className="text-[10px] h-4 px-1 border-amber-500/50 text-amber-600">DRY RUN</Badge>}
                      {p.escalate_instead && <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-500/50 text-orange-600">ESKALATION</Badge>}
                      <Badge variant="outline" className="text-[10px] h-4 px-1">{p.severity}</Badge>
                    </div>
                    {p.last_run_at && (
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        Letzter Lauf: {new Date(p.last_run_at).toLocaleString('de-DE')}
                        {typeof lastUpdated === 'number' && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">{lastUpdated} geheilt</Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setEditingId(isEditing ? null : p.id)}
                  >
                    <Settings2 className="h-3 w-3" />
                  </Button>
                  <Switch
                    checked={p.enabled}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, enabled: checked })}
                    disabled={toggleMutation.isPending}
                  />
                </div>
              </div>

              {isEditing && (
                <PolicyEditor
                  policy={p}
                  onSave={(patch) => updateMutation.mutate({ id: p.id, ...patch })}
                  saving={updateMutation.isPending}
                />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function PolicyEditor({
  policy,
  onSave,
  saving,
}: {
  policy: PolicyConfig;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const [threshold, setThreshold] = useState(String(policy.threshold_minutes));
  const [maxRun, setMaxRun] = useState(String(policy.max_per_run));
  const [cooldown, setCooldown] = useState(String(policy.cooldown_minutes));
  const [dryRun, setDryRun] = useState(policy.dry_run);
  const [escalate, setEscalate] = useState(policy.escalate_instead);
  const [maxHour, setMaxHour] = useState(String(policy.max_per_hour ?? ''));
  const [maxDay, setMaxDay] = useState(String(policy.max_per_day ?? ''));

  return (
    <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-[11px]">Schwelle (Min)</Label>
          <Input type="number" min={0} max={1440} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-[11px]">Max pro Lauf</Label>
          <Input type="number" min={1} max={100} value={maxRun} onChange={(e) => setMaxRun(e.target.value)} className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-[11px]">Cooldown (Min)</Label>
          <Input type="number" min={1} max={120} value={cooldown} onChange={(e) => setCooldown(e.target.value)} className="h-8 text-sm mt-1" />
        </div>
      </div>

      {/* Safety Rails */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1">
          <Shield className="h-3 w-3" /> Safety Rails
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={dryRun} onCheckedChange={setDryRun} />
            <Label className="text-[11px]">Dry Run</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={escalate} onCheckedChange={setEscalate} />
            <Label className="text-[11px]">Eskalieren statt heilen</Label>
          </div>
          <div>
            <Label className="text-[11px]">Max/Stunde</Label>
            <Input type="number" min={0} value={maxHour} onChange={(e) => setMaxHour(e.target.value)} className="h-7 text-xs mt-1" placeholder="∞" />
          </div>
          <div>
            <Label className="text-[11px]">Max/Tag</Label>
            <Input type="number" min={0} value={maxDay} onChange={(e) => setMaxDay(e.target.value)} className="h-7 text-xs mt-1" placeholder="∞" />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => onSave({
            threshold_minutes: parseInt(threshold) || policy.threshold_minutes,
            max_per_run: parseInt(maxRun) || policy.max_per_run,
            cooldown_minutes: parseInt(cooldown) || policy.cooldown_minutes,
            dry_run: dryRun,
            escalate_instead: escalate,
            max_per_hour: maxHour ? parseInt(maxHour) : null,
            max_per_day: maxDay ? parseInt(maxDay) : null,
          })}
          disabled={saving}
        >
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Speichern
        </Button>
      </div>
    </div>
  );
}
