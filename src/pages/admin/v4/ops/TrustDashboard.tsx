import { useEffect, useState, useCallback } from 'react';
import { Award } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loading, MiniKPI } from './OpsShared';

export default function TrustDashboard() {
  const [scores, setScores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('package_quality_scores').select('*, course_packages(title, certification_id)')
      .order('updated_at', { ascending: false }).limit(50);
    setScores(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;

  const BADGE_EMOJI: Record<string, string> = { platinum: '💎', gold: '🥇', silver: '🥈', bronze: '🥉' };
  const platCount = scores.filter(s => s.badge === 'platinum').length;
  const goldCount = scores.filter(s => s.badge === 'gold').length;
  const silverCount = scores.filter(s => s.badge === 'silver').length;
  const bronzeCount = scores.filter(s => s.badge === 'bronze').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniKPI label="💎 Platin" value={platCount} />
        <MiniKPI label="🥇 Gold" value={goldCount} />
        <MiniKPI label="🥈 Silber" value={silverCount} />
        <MiniKPI label="🥉 Bronze" value={bronzeCount} alert={bronzeCount > goldCount} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Award className="h-4 w-4" /> Quality Scores (Public View)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 px-3">Paket</th>
                  <th className="text-center py-2 px-3">Badge</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-right py-2 px-3">Version</th>
                  <th className="text-left py-2 px-3">Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s: any) => (
                  <tr key={s.package_id} className="border-b border-border/30">
                    <td className="py-2 px-3 font-medium truncate max-w-[200px]">{s.course_packages?.title || s.package_id?.slice(0, 8)}</td>
                    <td className="py-2 px-3 text-center text-lg">{BADGE_EMOJI[s.badge] || '–'}</td>
                    <td className={cn("py-2 px-3 text-right font-bold",
                      s.score >= 85 ? "text-emerald-600" : s.score >= 75 ? "text-yellow-600" : "text-destructive"
                    )}>{s.score}</td>
                    <td className="py-2 px-3 text-right text-muted-foreground">V{s.score_version}</td>
                    <td className="py-2 px-3 text-muted-foreground">{new Date(s.updated_at).toLocaleDateString('de-DE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
