/**
 * LaunchReadinessDashboardCard
 * ----------------------------
 * Single overall traffic-light for "can we sell ExamFit today?".
 * Reads SSOT via admin_get_launch_readiness_dashboard.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, Rocket, ShieldCheck, ShieldAlert } from 'lucide-react';

type Check = {
  key: string;
  label: string;
  status: 'green' | 'yellow' | 'red';
  blocker_count: number;
  primary_blocker: string | null;
  recommended_action: string | null;
  link: string | null;
};
type Dashboard = {
  generated_at: string;
  overall_status: 'green' | 'yellow' | 'red';
  can_soft_launch: boolean;
  can_public_launch: boolean;
  sellable_courses: number;
  empty_published: number;
  l2_safe_to_enforce: boolean;
  l2_enforce_recommended: boolean;
  checks: Check[];
};

const STATUS_BADGE: Record<Check['status'], 'default' | 'secondary' | 'destructive'> = {
  green: 'default',
  yellow: 'secondary',
  red: 'destructive',
};

export default function LaunchReadinessDashboardCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-launch-readiness-dashboard'],
    queryFn: async (): Promise<Dashboard> => {
      const { data, error } = await supabase.rpc(
        'admin_get_launch_readiness_dashboard' as any,
      );
      if (error) throw error;
      return data as Dashboard;
    },
    refetchInterval: 60_000,
  });

  const d = q.data;
  const overall = d?.overall_status ?? 'red';

  return (
    <Card className="border-2">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-text-secondary" />
          <CardTitle>Launch Readiness</CardTitle>
          <Badge variant={STATUS_BADGE[overall]} className="ml-2 uppercase">
            {overall}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin-launch-readiness-dashboard'] })}
          >
            <RefreshCcw className="h-4 w-4 mr-1" /> Re-check
          </Button>
        </div>
        <CardDescription>
          „Können wir verkaufen?“ — Gesamt-Ampel über alle launchrelevanten Checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> lade …
          </div>
        ) : !d ? (
          <div className="text-sm text-text-secondary">keine Daten</div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-border-subtle rounded-md p-3 bg-surface-1">
                <div className="flex items-center gap-2 text-sm">
                  {d.can_soft_launch ? (
                    <ShieldCheck className="h-4 w-4 text-text-secondary" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-destructive" />
                  )}
                  <strong>Soft Launch</strong>
                  <Badge variant={d.can_soft_launch ? 'default' : 'destructive'}>
                    {d.can_soft_launch ? 'erlaubt' : 'blockiert'}
                  </Badge>
                </div>
                <div className="text-xs text-text-tertiary mt-1">
                  {d.sellable_courses} verkaufbare Kurse
                </div>
              </div>
              <div className="border border-border-subtle rounded-md p-3 bg-surface-1">
                <div className="flex items-center gap-2 text-sm">
                  {d.can_public_launch ? (
                    <ShieldCheck className="h-4 w-4 text-text-secondary" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-destructive" />
                  )}
                  <strong>Public Launch</strong>
                  <Badge variant={d.can_public_launch ? 'default' : 'destructive'}>
                    {d.can_public_launch ? 'erlaubt' : 'blockiert'}
                  </Badge>
                </div>
                <div className="text-xs text-text-tertiary mt-1">
                  L2 enforce empfohlen: {d.l2_enforce_recommended ? 'ja' : 'nein'}
                </div>
              </div>
            </div>

            <div className="overflow-hidden border border-border-subtle rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-text-tertiary text-xs uppercase">
                  <tr>
                    <th className="text-left p-2">Check</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2">Blocker</th>
                    <th className="text-left p-2">Primary</th>
                    <th className="text-left p-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {d.checks.map((c) => (
                    <tr key={c.key} className="border-t border-border-subtle">
                      <td className="p-2">
                        {c.link ? (
                          <Link to={c.link} className="hover:underline">{c.label}</Link>
                        ) : c.label}
                      </td>
                      <td className="p-2">
                        <Badge variant={STATUS_BADGE[c.status]} className="uppercase">
                          {c.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-mono">{c.blocker_count}</td>
                      <td className="p-2 text-xs text-text-tertiary">
                        {c.primary_blocker ?? '—'}
                      </td>
                      <td className="p-2 text-xs text-text-tertiary">
                        {c.recommended_action ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-text-tertiary text-right">
              generiert {new Date(d.generated_at).toLocaleString('de-DE')}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
