/**
 * SoftLaunchPromotionCard
 * -----------------------
 * Listet Kandidaten für den Soft-Launch:
 *  - aktuell sellable Kurse (zum „Demote“)
 *  - promotable Kurse (genug lessons_ready, nur Visibility hochzustellen)
 *  - heilbare Kurse (lessons_ready=0, aber Pipeline-Heal möglich)
 *
 * Aktionen:
 *  - Promote → admin_set_product_visibility(product, 'public')
 *  - Demote  → admin_set_product_visibility(product, 'private')
 *  - Heal    → admin_heal_course_lessons(course)  (resetet failed → pending + enqueued generate-content)
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, Rocket, Wrench, EyeOff } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type Row = {
  course_id: string;
  course_title: string;
  curriculum_id: string;
  product_id: string;
  product_slug: string | null;
  visibility: string;
  modules: number;
  lessons: number;
  lessons_ready: number;
  lessons_pending: number;
  lessons_failed: number;
  package_id: string | null;
  package_status: string | null;
  has_active_jobs: boolean;
  is_currently_sellable: boolean;
  is_promotable: boolean;
};

export default function SoftLaunchPromotionCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['admin-softlaunch-candidates'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc(
        'admin_list_softlaunch_candidates' as any,
        { _min_lessons_ready: 50, _limit: 40 },
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    refetchInterval: 30_000,
  });

  const promote = useMutation({
    mutationFn: async (vars: { product_id: string; to: 'public' | 'private'; reason: string }) => {
      const { data, error } = await supabase.rpc(
        'admin_set_product_visibility' as any,
        { _product_id: vars.product_id, _visibility: vars.to, _reason: vars.reason },
      );
      if (error) throw error;
      return data as { ok: boolean; old?: string; new?: string; error?: string };
    },
    onSuccess: (res, vars) => {
      if (res?.ok) toast({ title: `Visibility → ${vars.to}`, description: `${res.old} → ${res.new}` });
      else toast({ title: 'Fehler', description: res?.error ?? 'unknown', variant: 'destructive' });
      qc.invalidateQueries({ queryKey: ['admin-softlaunch-candidates'] });
      qc.invalidateQueries({ queryKey: ['admin-launch-readiness-dashboard'] });
    },
  });

  const heal = useMutation({
    mutationFn: async (course_id: string) => {
      const { data, error } = await supabase.rpc('admin_heal_course_lessons' as any, { _course_id: course_id });
      if (error) throw error;
      return data as { ok: boolean; failed_reset?: number; pending_total?: number; job_id?: string; error?: string };
    },
    onSuccess: (res) => {
      if (res?.ok) toast({
        title: 'Heal-Job enqueued',
        description: `failed→pending: ${res.failed_reset} · pending total: ${res.pending_total}`,
      });
      else toast({ title: 'Heal blockiert', description: res?.error ?? 'unknown', variant: 'destructive' });
      qc.invalidateQueries({ queryKey: ['admin-softlaunch-candidates'] });
    },
  });

  const rows = q.data ?? [];
  const sellable = rows.filter(r => r.is_currently_sellable);
  const promotable = rows.filter(r => r.is_promotable && r.lessons_ready >= 50);
  const healable = rows.filter(r => !r.is_currently_sellable && !r.is_promotable && r.visibility !== 'public');

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-text-secondary" />
          <CardTitle>Soft-Launch Promotion</CardTitle>
          <Badge variant="default">{sellable.length} sellable</Badge>
          <Badge variant="secondary">{promotable.length} promotable</Badge>
          <Badge variant="outline">{healable.length} healable</Badge>
          <Button variant="outline" size="sm" className="ml-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin-softlaunch-candidates'] })}>
            <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
        <CardDescription>
          Verkaufbare Kurse promoten · Schwache demoten · Pipeline für non-sellable heilen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> lade …
          </div>
        ) : (
          <>
            <Section title={`Aktuell sellable (${sellable.length})`} rows={sellable}
              renderAction={(r) => (
                <Button size="sm" variant="outline" disabled={promote.isPending}
                  onClick={() => { setBusy(r.product_id); promote.mutate({ product_id: r.product_id, to: 'private', reason: 'admin_demote_softlaunch_card' }); }}>
                  <EyeOff className="h-3 w-3 mr-1" /> Demote
                </Button>
              )} />

            <Section title={`Promotable (≥50 ready, nicht public) — ${promotable.length}`} rows={promotable}
              renderAction={(r) => (
                <Button size="sm" disabled={promote.isPending}
                  onClick={() => { setBusy(r.product_id); promote.mutate({ product_id: r.product_id, to: 'public', reason: 'admin_promote_softlaunch_card' }); }}>
                  <Rocket className="h-3 w-3 mr-1" /> Promote → public
                </Button>
              )} />

            <Section title={`Healable (lessons_ready < 50) — ${healable.length}`} rows={healable.slice(0, 20)}
              renderAction={(r) => (
                <Button size="sm" variant="outline" disabled={heal.isPending || r.has_active_jobs}
                  title={r.has_active_jobs ? 'Aktiver Job läuft bereits' : 'Failed → pending + Generate-Content enqueuen'}
                  onClick={() => { setBusy(r.course_id); heal.mutate(r.course_id); }}>
                  <Wrench className="h-3 w-3 mr-1" />
                  {r.has_active_jobs ? 'job läuft' : 'Heal'}
                </Button>
              )} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, rows, renderAction }: {
  title: string; rows: Row[]; renderAction: (r: Row) => React.ReactNode;
}) {
  if (!rows.length) return (
    <div>
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="text-xs text-text-tertiary">— keine —</div>
    </div>
  );
  return (
    <div>
      <div className="text-sm font-semibold mb-2">{title}</div>
      <div className="overflow-hidden border border-border-subtle rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-surface-1 text-text-tertiary uppercase">
            <tr>
              <th className="text-left p-2">Kurs</th>
              <th className="text-right p-2">Modules</th>
              <th className="text-right p-2">Ready</th>
              <th className="text-right p-2">Pending</th>
              <th className="text-right p-2">Failed</th>
              <th className="text-left p-2">Visibility</th>
              <th className="text-right p-2">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.course_id} className="border-t border-border-subtle">
                <td className="p-2">
                  <div className="font-medium">{r.course_title}</div>
                  <div className="text-text-tertiary font-mono text-[10px]">{r.product_slug ?? '—'}</div>
                </td>
                <td className="p-2 text-right font-mono">{r.modules}</td>
                <td className="p-2 text-right font-mono">{r.lessons_ready}</td>
                <td className="p-2 text-right font-mono">{r.lessons_pending}</td>
                <td className="p-2 text-right font-mono">{r.lessons_failed}</td>
                <td className="p-2">
                  <Badge variant={r.visibility === 'public' ? 'default' : 'outline'}>{r.visibility}</Badge>
                </td>
                <td className="p-2 text-right">{renderAction(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
