// ConversationOS — Debrief Page
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Award, AlertTriangle, CheckCircle2, Target, Loader2, RotateCcw, Quote, TrendingUp, Flame, Wrench } from 'lucide-react';
import { toast } from 'sonner';

export default function ConversationOSDebriefPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [debrief, setDebrief] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('conversation-os-debrief', {
          body: { session_id: sessionId },
        });
        if (error) throw error;
        setDebrief(data.debrief);
      } catch (e: any) {
        toast.error('Konnte Debrief nicht laden', { description: e.message });
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Coach analysiert das Gespräch...</p>
        </div>
      </div>
    );
  }

  if (!debrief) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 max-w-md text-center space-y-4">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p>Debrief nicht verfügbar.</p>
          <Link to="/os/hr-interview"><Button>Zurück</Button></Link>
        </Card>
      </div>
    );
  }

  const totalScore = debrief.rubric_breakdown?.reduce((acc: number, r: any) => acc + r.score, 0) / (debrief.rubric_breakdown?.length || 1);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/os/hr-interview"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
            <div>
              <h1 className="font-semibold">Debrief</h1>
              <p className="text-xs text-muted-foreground">HR InterviewOS</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/os/hr-interview/history"><Button variant="outline" size="sm">Historie</Button></Link>
            <Button size="sm" onClick={() => navigate(-1)}><RotateCcw className="h-4 w-4 mr-2" />Erneut üben</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {/* Score-Hero */}
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-8">
            <div className="flex items-start gap-6">
              <div className="text-center">
                <div className="text-5xl font-bold text-primary">{Math.round(totalScore)}</div>
                <div className="text-xs text-muted-foreground mt-1">von 100</div>
                {debrief.certificate_eligible && (
                  <Badge className="mt-2 gap-1"><Award className="h-3 w-3" />Mastery</Badge>
                )}
              </div>
              <div className="flex-1">
                <h2 className="font-semibold mb-2">Coach-Einschätzung</h2>
                <p className="text-sm leading-relaxed text-foreground">{debrief.executive_summary}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rubric Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4" />Bewertung pro Dimension</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(debrief.rubric_breakdown ?? []).map((r: any, i: number) => (
              <div key={i} className="border-l-2 border-primary/30 pl-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm capitalize">{r.dimension.replace(/_/g, ' ')}</span>
                  <span className="text-sm font-mono">{r.score}/100</span>
                </div>
                <Progress value={r.score} className="h-1.5" />
                <p className="text-xs text-muted-foreground">{r.why}</p>
                {r.evidence_quote && (
                  <blockquote className="text-xs italic text-muted-foreground border-l border-border pl-2 mt-1">
                    <Quote className="h-3 w-3 inline mr-1" />&quot;{r.evidence_quote}&quot;
                  </blockquote>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Critical Moments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Kritische Momente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(debrief.critical_moments ?? []).map((m: any, i: number) => (
              <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={m.moment_type === 'strong_move' ? 'default' : m.moment_type === 'critical_error' ? 'destructive' : 'outline'} className="text-xs">
                    {m.moment_type.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Turn #{m.turn_index}</span>
                </div>
                <blockquote className="text-sm italic border-l-2 border-primary/30 pl-3">&quot;{m.quote}&quot;</blockquote>
                <p className="text-sm">{m.analysis}</p>
                <div className="text-xs bg-primary/5 border border-primary/20 rounded p-2">
                  <span className="font-medium">Bessere Alternative:</span> {m.better_alternative}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Improvement Plan */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Nächste Schritte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(debrief.improvement_plan ?? []).map((p: any, i: number) => (
              <div key={i} className="flex gap-3">
                <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">{i + 1}</div>
                <div className="space-y-1">
                  <div className="font-medium text-sm">{p.focus}</div>
                  <p className="text-xs text-muted-foreground">{p.why}</p>
                  <p className="text-xs"><span className="font-medium">Übung:</span> {p.drill_suggestion}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* State Trajectory */}
        {Array.isArray(debrief.state_trajectory) && debrief.state_trajectory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gesprächs-Dynamik</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {['trust', 'tension', 'confidence', 'rapport'].map((dim) => {
                  const final = debrief.state_trajectory[debrief.state_trajectory.length - 1]?.[dim] ?? 0.5;
                  return (
                    <div key={dim} className="border border-border rounded p-2 text-center">
                      <div className="text-muted-foreground capitalize">{dim}</div>
                      <div className="text-lg font-mono">{Math.round(final * 100)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
