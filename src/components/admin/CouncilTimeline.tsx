import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Brain, CheckCircle2, XCircle, Clock, MessageSquare,
  Play, RotateCcw, Loader2, ChevronDown, ChevronRight,
  ThumbsUp, ThumbsDown, AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  packageId: string;
  councils: any[];
  onRefresh: () => void;
}

const COUNCIL_LABELS: Record<string, string> = {
  didactic: 'Didaktik',
  exam: 'Prüfungsfragen',
  question_quality: 'Fragenqualität',
  oral: 'Mündliche Prüfung',
  tutor: 'AI Tutor',
  handbook: 'Handbuch',
  seo_commercial: 'SEO & Marketing',
  education: 'Education',
  assessment: 'Assessment',
  tech: 'Technik',
  compliance: 'Compliance',
  growth: 'Growth',
  finance: 'Finanzen',
  qa: 'QA',
  security: 'Security',
  marketing: 'Marketing',
};

export default function CouncilTimeline({ packageId, councils, onRefresh }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, any[]>>({});
  const [verdicts, setVerdicts] = useState<Record<string, any>>({});
  const [votes, setVotes] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [triggeringCouncil, setTriggeringCouncil] = useState<string | null>(null);

  // Load details when expanding a council
  const loadCouncilDetails = async (councilId: string) => {
    // Try loading from council_messages via content_version linkage
    // For now, load from council_sessions discussion field
    const session = councils.find(c => c.id === councilId);
    if (session?.discussion) {
      const msgs = Array.isArray(session.discussion) ? session.discussion : 
        typeof session.discussion === 'object' ? [session.discussion] : [];
      setMessages(prev => ({ ...prev, [councilId]: msgs }));
    }
  };

  const handleExpand = (councilId: string) => {
    if (expanded === councilId) {
      setExpanded(null);
    } else {
      setExpanded(councilId);
      if (!messages[councilId]) loadCouncilDetails(councilId);
    }
  };

  // Manual council trigger
  const handleTriggerCouncilRun = async (councilType: string) => {
    setTriggeringCouncil(councilType);
    try {
      const { data: { session } } = await (supabase.auth as any).getSession();
      const { error } = await supabase.functions.invoke('council-api', {
        body: { action: 'run', packageId, councilType },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (error) throw error;
      toast.success(`Council "${COUNCIL_LABELS[councilType] || councilType}" gestartet`);
      onRefresh();
    } catch (e: any) {
      toast.error(`Council-Fehler: ${e.message}`);
    } finally {
      setTriggeringCouncil(null);
    }
  };

  // Override verdict
  const handleOverrideVerdict = async (councilId: string, decision: 'approve' | 'rejected') => {
    setLoading(councilId);
    try {
      await (supabase as any).from('council_sessions')
        .update({
          decision,
          status: decision === 'approve' ? 'approved' : 'rejected',
          decided_by: 'admin_override',
          decided_at: new Date().toISOString(),
        })
        .eq('id', councilId);
      
      toast.success(`Verdict überschrieben: ${decision}`);
      onRefresh();
    } catch (e: any) {
      toast.error(`Override fehlgeschlagen: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  // Re-run council
  const handleReRunCouncil = async (councilId: string, councilType: string) => {
    setLoading(councilId);
    try {
      // Reset session
      await (supabase as any).from('council_sessions')
        .update({ status: 'pending', decision: null, decided_at: null, decided_by: null, discussion: null })
        .eq('id', councilId);

      // Trigger new run
      await handleTriggerCouncilRun(councilType);
    } catch (e: any) {
      toast.error(`Re-Run fehlgeschlagen: ${e.message}`);
    } finally {
      setLoading(null);
    }
  };

  if (councils.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center">
          <Brain className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-3">Noch keine Council-Sessions</p>
          <Button size="sm" onClick={() => handleTriggerCouncilRun('didactic')}
            disabled={triggeringCouncil !== null}>
            {triggeringCouncil ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Council einberufen
          </Button>
        </CardContent>
      </Card>
    );
  }

  const approvedCount = councils.filter(c => c.decision === 'approve' || c.status === 'approved').length;
  const rejectedCount = councils.filter(c => c.decision === 'rejected' || c.status === 'rejected').length;
  const pendingCount = councils.filter(c => !c.decision && c.status !== 'approved' && c.status !== 'rejected').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Brain className="h-4 w-4" /> Council-Entscheidungen
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] bg-success/10 text-success">
              ✓ {approvedCount}
            </Badge>
            {rejectedCount > 0 && (
              <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive">
                ✗ {rejectedCount}
              </Badge>
            )}
            {pendingCount > 0 && (
              <Badge variant="outline" className="text-[10px]">
                ⏳ {pendingCount}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {councils.map(council => {
          const isExpanded = expanded === council.id;
          const label = COUNCIL_LABELS[council.council_type] || council.council_type;
          const isApproved = council.decision === 'approve' || council.status === 'approved';
          const isRejected = council.decision === 'rejected' || council.status === 'rejected';
          const isPending = !council.decision && council.status !== 'approved' && council.status !== 'rejected';
          const isRunning = council.status === 'running' || council.status === 'deliberating';
          const councilMsgs = messages[council.id] || [];

          return (
            <div key={council.id} className={cn("border rounded-lg transition-colors",
              isRejected ? "border-destructive/30" : isApproved ? "border-success/30" : "border-border/30"
            )}>
              {/* Header */}
              <button
                className="w-full flex items-center justify-between gap-3 py-2.5 px-3 text-left hover:bg-muted/30 rounded-lg transition-colors"
                onClick={() => handleExpand(council.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isApproved ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> :
                   isRejected ? <XCircle className="h-4 w-4 text-destructive shrink-0" /> :
                   isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" /> :
                   <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="text-sm font-medium truncate">{label}</span>
                  {council.decided_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(council.decided_at).toLocaleDateString('de-DE')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={cn("text-[10px]",
                    isApproved ? 'bg-success/10 text-success' :
                    isRejected ? 'bg-destructive/10 text-destructive' :
                    isRunning ? 'bg-primary/10 text-primary' : ''
                  )}>
                    {isApproved ? 'Approved' : isRejected ? 'Rejected' : isRunning ? 'Läuft…' : 'Ausstehend'}
                  </Badge>
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </div>
              </button>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-border/20 pt-2">
                  {/* Discussion / Messages */}
                  {councilMsgs.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {councilMsgs.map((msg: any, i: number) => (
                        <div key={i} className="bg-muted/20 rounded p-2">
                          <div className="flex items-center gap-2 mb-1">
                            <MessageSquare className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[10px] font-medium text-foreground">
                              {msg.agent_name || msg.role || 'Agent'}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {msg.message_type || msg.type || ''}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-3">
                            {typeof msg.message_json === 'string' ? msg.message_json :
                             typeof msg.content === 'string' ? msg.content :
                             JSON.stringify(msg.message_json || msg).slice(0, 200)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recommendations */}
                  {council.recommendations && (
                    <div className="bg-primary/5 rounded p-2">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Empfehlungen</p>
                      <p className="text-xs text-foreground">
                        {typeof council.recommendations === 'string' ? council.recommendations :
                         JSON.stringify(council.recommendations).slice(0, 300)}
                      </p>
                    </div>
                  )}

                  {/* Interactive Actions */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {/* Override buttons */}
                    {!isApproved && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-success border-success/30"
                        onClick={() => handleOverrideVerdict(council.id, 'approve')}
                        disabled={loading === council.id}>
                        <ThumbsUp className="h-3 w-3 mr-1" /> Approve Override
                      </Button>
                    )}
                    {!isRejected && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30"
                        onClick={() => handleOverrideVerdict(council.id, 'rejected')}
                        disabled={loading === council.id}>
                        <ThumbsDown className="h-3 w-3 mr-1" /> Reject Override
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs"
                      onClick={() => handleReRunCouncil(council.id, council.council_type)}
                      disabled={loading === council.id || isRunning}>
                      {loading === council.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> :
                       <RotateCcw className="h-3 w-3 mr-1" />}
                      Re-Run
                    </Button>
                  </div>

                  {/* Decided by info */}
                  {council.decided_by && (
                    <p className="text-[10px] text-muted-foreground">
                      Entschieden von: {council.decided_by}
                      {council.decided_at && ` am ${new Date(council.decided_at).toLocaleString('de-DE')}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
