import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Building2, Users, AlertTriangle, TrendingUp, BarChart3,
  ShieldAlert, CheckCircle, Clock
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

// Aggregated B2B stats per course
function B2BOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['b2b-support-overview'],
    queryFn: async () => {
      // Get all tickets with course context grouped by course
      const { data: tickets } = await supabase
        .from('support_tickets')
        .select('id, status, sentiment, ticket_type, context_course_id, created_at, was_self_resolved')
        .not('context_course_id', 'is', null);

      // Get courses for names
      const courseIds = [...new Set((tickets || []).map(t => t.context_course_id).filter(Boolean))];
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title')
        .in('id', courseIds.length > 0 ? courseIds : ['none']);

      const courseMap = new Map((courses || []).map(c => [c.id, c.title]));

      // Aggregate per course
      const courseStats: Record<string, {
        courseId: string;
        courseName: string;
        totalTickets: number;
        openTickets: number;
        emotionalTickets: number;
        selfResolved: number;
        ticketTypes: Record<string, number>;
      }> = {};

      (tickets || []).forEach(t => {
        const cid = t.context_course_id!;
        if (!courseStats[cid]) {
          courseStats[cid] = {
            courseId: cid,
            courseName: courseMap.get(cid) || 'Unbekannt',
            totalTickets: 0,
            openTickets: 0,
            emotionalTickets: 0,
            selfResolved: 0,
            ticketTypes: {},
          };
        }
        const s = courseStats[cid];
        s.totalTickets++;
        if (t.status === 'open') s.openTickets++;
        if (t.sentiment === 'anxious' || t.sentiment === 'frustrated') s.emotionalTickets++;
        if (t.was_self_resolved) s.selfResolved++;
        const tt = t.ticket_type || 'general';
        s.ticketTypes[tt] = (s.ticketTypes[tt] || 0) + 1;
      });

      const sorted = Object.values(courseStats).sort((a, b) => b.totalTickets - a.totalTickets);

      // Get enrollment counts per course
      const { data: enrollments } = await supabase
        .from('course_enrollments')
        .select('course_id')
        .in('course_id', courseIds.length > 0 ? courseIds : ['none']);

      const enrollmentCounts: Record<string, number> = {};
      (enrollments || []).forEach(e => {
        enrollmentCounts[e.course_id] = (enrollmentCounts[e.course_id] || 0) + 1;
      });

      return { courseStats: sorted, enrollmentCounts, totalTickets: (tickets || []).length };
    },
  });

  if (isLoading) return <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;

  const topKPIs = [
    { label: 'Gesamt-Tickets (kursgebunden)', value: data?.totalTickets || 0, icon: BarChart3, color: 'text-blue-500' },
    { label: 'Kurse mit Support', value: data?.courseStats.length || 0, icon: Building2, color: 'text-purple-500' },
    {
      label: 'Höchster Frust-Index',
      value: data?.courseStats[0]
        ? `${data.courseStats[0].emotionalTickets} (${data.courseStats[0].courseName.slice(0, 25)}...)`
        : '–',
      icon: ShieldAlert,
      color: 'text-pink-500'
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        {topKPIs.map(kpi => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="glass-card">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted/50">
                    <Icon className={`h-5 w-5 ${kpi.color}`} />
                  </div>
                  <div>
                    <div className="text-lg font-bold">{kpi.value}</div>
                    <div className="text-sm text-muted-foreground">{kpi.label}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Course-level breakdown */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Support pro Kurs</CardTitle>
          <CardDescription>Aggregierte Daten – keine Einzeltickets sichtbar</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kurs</TableHead>
                <TableHead className="text-center">Tickets</TableHead>
                <TableHead className="text-center">Offen</TableHead>
                <TableHead className="text-center">Selbst gelöst</TableHead>
                <TableHead className="text-center">Emotional</TableHead>
                <TableHead>Support-Last</TableHead>
                <TableHead>Top-Typ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.courseStats.map(cs => {
                const selfRate = cs.totalTickets > 0 ? Math.round((cs.selfResolved / cs.totalTickets) * 100) : 0;
                const enrollments = data.enrollmentCounts[cs.courseId] || 1;
                const ticketsPerUser = (cs.totalTickets / enrollments).toFixed(1);
                const topType = Object.entries(cs.ticketTypes).sort((a, b) => b[1] - a[1])[0];

                return (
                  <TableRow key={cs.courseId}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{cs.courseName}</TableCell>
                    <TableCell className="text-center">{cs.totalTickets}</TableCell>
                    <TableCell className="text-center">
                      {cs.openTickets > 0 ? (
                        <Badge variant="destructive" className="text-xs">{cs.openTickets}</Badge>
                      ) : (
                        <CheckCircle className="h-4 w-4 text-green-500 mx-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <span className="text-sm">{selfRate}%</span>
                        <Progress value={selfRate} className="h-1.5 w-12" />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {cs.emotionalTickets > 0 ? (
                        <Badge variant="outline" className="text-xs text-pink-500 border-pink-500/30">{cs.emotionalTickets}</Badge>
                      ) : '–'}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{ticketsPerUser} / Nutzer</span>
                    </TableCell>
                    <TableCell>
                      {topType && <Badge variant="secondary" className="text-xs">{topType[0]}: {topType[1]}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!data?.courseStats || data.courseStats.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Noch keine kursgebundenen Tickets
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Risk indicators for businesses
function RiskIndicators() {
  const { data, isLoading } = useQuery({
    queryKey: ['b2b-risk-indicators'],
    queryFn: async () => {
      // Courses with high emotional ticket ratio
      const { data: tickets } = await supabase
        .from('support_tickets')
        .select('context_course_id, sentiment, ticket_type')
        .not('context_course_id', 'is', null);

      const courseEmotional: Record<string, { total: number; emotional: number; types: Record<string, number> }> = {};

      (tickets || []).forEach(t => {
        const cid = t.context_course_id!;
        if (!courseEmotional[cid]) courseEmotional[cid] = { total: 0, emotional: 0, types: {} };
        courseEmotional[cid].total++;
        if (t.sentiment === 'anxious' || t.sentiment === 'frustrated') courseEmotional[cid].emotional++;
        const tt = t.ticket_type || 'general';
        courseEmotional[cid].types[tt] = (courseEmotional[cid].types[tt] || 0) + 1;
      });

      // Find high-risk courses (emotional > 30% of tickets)
      const risks = Object.entries(courseEmotional)
        .map(([courseId, stats]) => ({
          courseId,
          emotionalRate: stats.total > 0 ? Math.round((stats.emotional / stats.total) * 100) : 0,
          total: stats.total,
          emotional: stats.emotional,
          topType: Object.entries(stats.types).sort((a, b) => b[1] - a[1])[0]?.[0] || 'general',
        }))
        .filter(r => r.emotionalRate > 20 || r.total > 5)
        .sort((a, b) => b.emotionalRate - a.emotionalRate);

      // Get course names
      const ids = risks.map(r => r.courseId);
      const { data: courses } = await supabase
        .from('courses')
        .select('id, title')
        .in('id', ids.length > 0 ? ids : ['none']);
      const nameMap = new Map((courses || []).map(c => [c.id, c.title]));

      return risks.map(r => ({ ...r, courseName: nameMap.get(r.courseId) || 'Unbekannt' }));
    },
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">Kurse mit erhöhtem Risikoprofil (Frust/Angst &gt; 20% oder &gt; 5 Tickets)</p>

      {data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map(risk => (
            <Card key={risk.courseId} className={`glass-card ${risk.emotionalRate > 40 ? 'border-destructive/30' : 'border-amber-500/20'}`}>
              <CardContent className="py-4 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className={`h-5 w-5 ${risk.emotionalRate > 40 ? 'text-destructive' : 'text-amber-500'}`} />
                    <div>
                      <div className="font-medium text-sm">{risk.courseName}</div>
                      <div className="text-xs text-muted-foreground">
                        {risk.total} Tickets · {risk.emotional} emotional · Top: {risk.topType}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold">{risk.emotionalRate}%</div>
                    <div className="text-xs text-muted-foreground">Frust-Index</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="glass-card">
          <CardContent className="py-8 text-center text-muted-foreground">
            <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p>Keine Risiko-Kurse erkannt</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function B2BSupportDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-3">
          <Building2 className="h-7 w-7 text-primary" />
          B2B Support-Übersicht
        </h1>
        <p className="text-muted-foreground">Aggregierte Daten für Betriebe & Institutionen – keine Einzeltickets</p>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Kurs-Übersicht
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-2">
            <AlertTriangle className="h-4 w-4" /> Risiko-Indikatoren
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><B2BOverview /></TabsContent>
        <TabsContent value="risks"><RiskIndicators /></TabsContent>
      </Tabs>
    </div>
  );
}
