import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  BarChart3, MessageSquare, HeartCrack, AlertTriangle, TrendingUp,
  Bot, BookOpen, CheckCircle, XCircle, Loader2, Sparkles, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// KPI Cards
function SupportKPIs() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['support-dashboard-kpis'],
    queryFn: async () => {
      const [ticketsRes, aiRes, faqRes, feedbackRes] = await Promise.all([
        supabase.from('support_tickets').select('id, status, sentiment, ticket_type, created_at, was_self_resolved', { count: 'exact' }),
        supabase.from('support_ai_responses').select('id, was_helpful, tokens_used', { count: 'exact' }),
        supabase.from('support_faq').select('id, is_published, usage_count', { count: 'exact' }),
        supabase.from('support_feedback_loop').select('id, classification, improvement_status', { count: 'exact' }),
      ]);

      const tickets = ticketsRes.data || [];
      const aiResponses = aiRes.data || [];
      const faqs = faqRes.data || [];
      const feedback = feedbackRes.data || [];

      const openTickets = tickets.filter(t => t.status === 'open').length;
      const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;
      const selfResolved = tickets.filter(t => t.was_self_resolved).length;
      const anxiousTickets = tickets.filter(t => t.sentiment === 'anxious').length;
      const frustratedTickets = tickets.filter(t => t.sentiment === 'frustrated').length;
      
      const helpfulAi = aiResponses.filter(a => a.was_helpful === true).length;
      const totalAiFeedback = aiResponses.filter(a => a.was_helpful !== null).length;
      const aiHelpfulRate = totalAiFeedback > 0 ? Math.round((helpfulAi / totalAiFeedback) * 100) : 0;

      const publishedFaq = faqs.filter(f => f.is_published).length;
      const pendingFaq = faqs.filter(f => !f.is_published).length;

      const pendingImprovements = feedback.filter(f => f.improvement_status === 'candidate').length;

      // Top ticket types
      const typeCounts: Record<string, number> = {};
      tickets.forEach(t => {
        const type = t.ticket_type || 'general';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      });
      const topTypes = Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      return {
        total: tickets.length,
        openTickets,
        resolvedTickets,
        selfResolved,
        selfResolvedRate: tickets.length > 0 ? Math.round((selfResolved / tickets.length) * 100) : 0,
        anxiousTickets,
        frustratedTickets,
        aiResponseCount: aiResponses.length,
        aiHelpfulRate,
        publishedFaq,
        pendingFaq,
        pendingImprovements,
        topTypes,
      };
    },
  });

  if (isLoading) return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;

  const kpis = [
    { label: 'Offene Tickets', value: stats?.openTickets || 0, icon: MessageSquare, color: 'text-orange-500', desc: `${stats?.total || 0} gesamt` },
    { label: 'Self-Resolved Rate', value: `${stats?.selfResolvedRate || 0}%`, icon: CheckCircle, color: 'text-green-500', desc: `${stats?.selfResolved || 0} selbst gelöst` },
    { label: 'KI-Hilfe-Rate', value: `${stats?.aiHelpfulRate || 0}%`, icon: Bot, color: 'text-blue-500', desc: `${stats?.aiResponseCount || 0} AI Antworten` },
    { label: 'Emotional Kritisch', value: (stats?.anxiousTickets || 0) + (stats?.frustratedTickets || 0), icon: HeartCrack, color: 'text-pink-500', desc: `${stats?.anxiousTickets || 0} Angst, ${stats?.frustratedTickets || 0} Frust` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Icon className={`h-5 w-5 ${kpi.color}`} />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{kpi.value}</div>
                    <div className="text-sm font-medium">{kpi.label}</div>
                    <div className="text-xs text-muted-foreground">{kpi.desc}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Top ticket types */}
      {stats?.topTypes && stats.topTypes.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Top Ticket-Typen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {stats.topTypes.map(([type, count]) => (
                <Badge key={type} variant="outline" className="text-sm py-1 px-3">
                  {type}: <strong className="ml-1">{count}</strong>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// FAQ Management Tab
function FAQManagementTab() {
  const queryClient = useQueryClient();
  
  const { data: faqs, isLoading } = useQuery({
    queryKey: ['support-faq-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_faq')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const generateFaq = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('support-faq-generate');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.generated} neue FAQ-Einträge generiert`);
      queryClient.invalidateQueries({ queryKey: ['support-faq-admin'] });
    },
    onError: () => toast.error('Fehler beim Generieren'),
  });

  const togglePublish = useMutation({
    mutationFn: async ({ id, publish }: { id: string; publish: boolean }) => {
      const { error } = await supabase
        .from('support_faq')
        .update({ is_published: publish } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-faq-admin'] });
      toast.success('FAQ aktualisiert');
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const pending = faqs?.filter(f => !f.is_published) || [];
  const published = faqs?.filter(f => f.is_published) || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-muted-foreground">
            {pending.length} ausstehend · {published.length} veröffentlicht
          </p>
        </div>
        <Button onClick={() => generateFaq.mutate()} disabled={generateFaq.isPending}>
          {generateFaq.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          FAQ aus Tickets generieren
        </Button>
      </div>

      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Zur Freigabe ({pending.length})
          </h3>
          <div className="space-y-3">
            {pending.map(faq => (
              <Card key={faq.id} className="glass-card border-yellow-500/20">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{faq.question}</div>
                      <div className="text-xs text-muted-foreground mt-1">{faq.answer}</div>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline" className="text-xs">{faq.ticket_type}</Badge>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => togglePublish.mutate({ id: faq.id, publish: true })}>
                        <CheckCircle className="h-3 w-3 mr-1" /> Freigeben
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive">
                        <XCircle className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {published.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Veröffentlicht ({published.length})
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Frage</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Aufrufe</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {published.map(faq => (
                <TableRow key={faq.id}>
                  <TableCell className="font-medium text-sm max-w-md truncate">{faq.question}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{faq.ticket_type}</Badge></TableCell>
                  <TableCell>{faq.usage_count || 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => togglePublish.mutate({ id: faq.id, publish: false })}>
                      Deaktivieren
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Feedback Loop Tab
function FeedbackLoopTab() {
  const { data: feedback, isLoading } = useQuery({
    queryKey: ['support-feedback-loop'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_feedback_loop')
        .select('*, support_tickets(subject, ticket_type)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const classLabels: Record<string, { label: string; color: string }> = {
    didactic_problem: { label: 'Didaktisch', color: 'text-purple-500' },
    understanding_gap: { label: 'Verständnis', color: 'text-blue-500' },
    unclear_question: { label: 'Unklar', color: 'text-yellow-500' },
    technical_problem: { label: 'Technisch', color: 'text-orange-500' },
  };

  const statusColors: Record<string, string> = {
    candidate: 'bg-yellow-500/10 text-yellow-700',
    approved: 'bg-blue-500/10 text-blue-700',
    implemented: 'bg-green-500/10 text-green-700',
    rejected: 'bg-red-500/10 text-red-700',
  };

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Automatisch erkannte Verbesserungskandidaten aus Support-Tickets
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticket</TableHead>
            <TableHead>Klassifikation</TableHead>
            <TableHead>Verbesserung</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Datum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {feedback?.map((item) => {
            const cls = classLabels[item.classification] || { label: item.classification, color: '' };
            return (
              <TableRow key={item.id}>
                <TableCell className="font-medium text-sm max-w-xs truncate">
                  {(item as any).support_tickets?.subject || '-'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-xs ${cls.color}`}>{cls.label}</Badge>
                </TableCell>
                <TableCell className="text-sm">{item.improvement_type || '-'}</TableCell>
                <TableCell>
                  <Badge className={`text-xs ${statusColors[item.improvement_status] || ''}`}>
                    {item.improvement_status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(item.created_at), 'dd.MM.yy', { locale: de })}
                </TableCell>
              </TableRow>
            );
          })}
          {(!feedback || feedback.length === 0) && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                Noch keine Feedback-Loop-Einträge
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// AI Response Log Tab
function AIResponseLogTab() {
  const { data: responses, isLoading } = useQuery({
    queryKey: ['support-ai-log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_ai_responses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        Jede KI-Antwort geloggt, versioniert & erklärbar
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Frage</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Hilfreich</TableHead>
            <TableHead>Datum</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responses?.map((resp) => (
            <TableRow key={resp.id}>
              <TableCell className="font-medium text-sm max-w-xs truncate">{resp.question}</TableCell>
              <TableCell><Badge variant="outline" className="text-xs">{resp.answer_type}</Badge></TableCell>
              <TableCell className="text-sm">{resp.tokens_used || '-'}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(resp.guardrail_flags as string[] || []).map((f, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">{f}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                {resp.was_helpful === true && <CheckCircle className="h-4 w-4 text-green-500" />}
                {resp.was_helpful === false && <XCircle className="h-4 w-4 text-red-500" />}
                {resp.was_helpful === null && <span className="text-xs text-muted-foreground">–</span>}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {format(new Date(resp.created_at), 'dd.MM.yy HH:mm', { locale: de })}
              </TableCell>
            </TableRow>
          ))}
          {(!responses || responses.length === 0) && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Noch keine KI-Antworten
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SupportDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Support Intelligence</h1>
        <p className="text-muted-foreground">KPIs, FAQ-Pipeline, Feedback-Loop & KI-Log</p>
      </div>

      <SupportKPIs />

      <Tabs defaultValue="faq" className="space-y-4">
        <TabsList>
          <TabsTrigger value="faq" className="gap-2">
            <BookOpen className="h-4 w-4" /> FAQ Pipeline
          </TabsTrigger>
          <TabsTrigger value="feedback" className="gap-2">
            <TrendingUp className="h-4 w-4" /> Feedback Loop
          </TabsTrigger>
          <TabsTrigger value="ai-log" className="gap-2">
            <Bot className="h-4 w-4" /> KI-Antworten Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="faq"><FAQManagementTab /></TabsContent>
        <TabsContent value="feedback"><FeedbackLoopTab /></TabsContent>
        <TabsContent value="ai-log"><AIResponseLogTab /></TabsContent>
      </Tabs>
    </div>
  );
}
