// ConversationOS — Session History
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Trophy, Loader2, MessageSquare } from 'lucide-react';

export default function ConversationOSHistoryPage() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('conversation_os_sessions')
        .select('id, scenario_id, status, total_score, rubric_scores, started_at, finished_at, turn_count, vertical_module, conversation_os_scenarios(title, vertical_module)')
        .order('started_at', { ascending: false })
        .limit(50);
      if (!error && data) setSessions(data);
      setLoading(false);
    })();
  }, []);

  // Mastery aggregation per dimension
  const dimensions: Record<string, number[]> = {};
  for (const s of sessions) {
    const rs = (s.rubric_scores ?? {}) as Record<string, number>;
    for (const [dim, score] of Object.entries(rs)) {
      if (!dimensions[dim]) dimensions[dim] = [];
      if (typeof score === 'number') dimensions[dim].push(score);
    }
  }
  const masteryAvgs = Object.entries(dimensions).map(([dim, scores]) => ({
    dim,
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    n: scores.length,
  })).sort((a, b) => b.avg - a.avg);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/os/hr-interview"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="font-semibold">Trainings-Historie</h1>
            <p className="text-xs text-muted-foreground">HR InterviewOS</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : sessions.length === 0 ? (
          <Card className="p-12 text-center space-y-4">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="font-semibold">Noch keine Trainings absolviert</h2>
            <Link to="/os/hr-interview"><Button>Erstes Training starten</Button></Link>
          </Card>
        ) : (
          <>
            {/* Mastery */}
            {masteryAvgs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" />Mastery pro Dimension</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {masteryAvgs.map((m) => (
                    <div key={m.dim} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize">{m.dim.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground">Ø {Math.round(m.avg)} · {m.n} Sessions</span>
                      </div>
                      <Progress value={m.avg} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Sessions List */}
            <Card>
              <CardHeader><CardTitle className="text-base">Sessions</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sessions.map((s) => (
                  <Link key={s.id} to={s.status === 'completed' ? `/os/hr-interview/debrief/${s.id}` : `/os/hr-interview/run/${s.scenario_id}`}>
                    <div className="flex items-center justify-between p-3 border border-border rounded hover:bg-accent/30 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{s.conversation_os_scenarios?.title ?? 'Session'}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(s.started_at).toLocaleString('de-DE')} · {s.turn_count} Turns
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={s.status === 'completed' ? 'default' : 'outline'}>{s.status}</Badge>
                        {s.total_score && <span className="font-mono text-sm">{Math.round(s.total_score)}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
