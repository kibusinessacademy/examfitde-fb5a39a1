import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Download, RefreshCw } from 'lucide-react';
import { downloadCsv, toCsv } from '@/lib/csv';

type Row = {
  id: string;
  created_at: string;
  event_type: string;
  user_id: string | null;
  lesson_id: string | null;
  curriculum_id: string | null;
  score: number | null;
  payload: Record<string, unknown> | null;
};

const EVENT_OPTIONS = [
  { value: 'all', label: 'Alle (h5p + lesson)' },
  { value: 'h5p_completed', label: 'h5p_completed' },
  { value: 'lesson_completed', label: 'lesson_completed' },
];

export default function AdminLearningEventsPage() {
  const [eventType, setEventType] = useState('all');
  const [lessonId, setLessonId] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = { eventType, lessonId: lessonId.trim(), userId: userId.trim(), from, to };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-learning-events', filters],
    queryFn: async () => {
      let q = supabase
        .from('learning_events')
        .select('id,created_at,event_type,user_id,lesson_id,curriculum_id,score,payload')
        .order('created_at', { ascending: false })
        .limit(500);

      if (eventType === 'all') q = q.in('event_type', ['h5p_completed', 'lesson_completed']);
      else q = q.eq('event_type', eventType);
      if (filters.lessonId) q = q.eq('lesson_id', filters.lessonId);
      if (filters.userId) q = q.eq('user_id', filters.userId);
      if (filters.from) q = q.gte('created_at', new Date(filters.from).toISOString());
      if (filters.to) q = q.lte('created_at', new Date(filters.to).toISOString());

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = data ?? [];
  const counts = useMemo(() => ({
    h5p: rows.filter((r) => r.event_type === 'h5p_completed').length,
    lesson: rows.filter((r) => r.event_type === 'lesson_completed').length,
  }), [rows]);

  const exportCsv = () => {
    if (!rows.length) return;
    const csv = toCsv(rows.map((r) => ({
      created_at: r.created_at,
      event_type: r.event_type,
      user_id: r.user_id,
      lesson_id: r.lesson_id,
      curriculum_id: r.curriculum_id,
      score: r.score,
      payload: r.payload ? JSON.stringify(r.payload) : '',
    })));
    downloadCsv(`learning-events-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-primary">Learning-Events Audit</h1>
        <p className="text-sm text-text-secondary mt-1">
          Live-Sicht auf <code>learning_events</code> für H5P-Completions und Lesson-Outcomes.
          Filter nach User, Lesson und Zeit; CSV-Export für Reports.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6 grid gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label>Event-Typ</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {EVENT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="uid">User-ID</Label>
            <Input id="uid" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lid">Lesson-ID</Label>
            <Input id="lid" value={lessonId} onChange={(e) => setLessonId(e.target.value)} placeholder="UUID" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="from">Von</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">Bis</Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">h5p_completed: {counts.h5p}</Badge>
          <Badge variant="outline">lesson_completed: {counts.lesson}</Badge>
          <span className="text-text-muted">· {rows.length} Zeilen (max 500)</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Aktualisieren
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Events</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : !rows.length ? (
            <p className="py-10 text-center text-text-muted">Keine Events für die aktuellen Filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-text-muted bg-surface-sunken">
                  <tr className="border-b border-border">
                    <th className="text-left p-2">Zeit</th>
                    <th className="text-left p-2">Event</th>
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Lesson</th>
                    <th className="text-left p-2">Score</th>
                    <th className="text-left p-2">Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-surface-sunken/50 align-top">
                      <td className="p-2 whitespace-nowrap text-text-secondary">{new Date(r.created_at).toLocaleString('de-DE')}</td>
                      <td className="p-2">
                        <Badge variant={r.event_type === 'h5p_completed' ? 'default' : 'secondary'}>{r.event_type}</Badge>
                      </td>
                      <td className="p-2 font-mono text-xs text-text-secondary truncate max-w-[10rem]">{r.user_id ?? '—'}</td>
                      <td className="p-2 font-mono text-xs text-text-secondary truncate max-w-[10rem]">{r.lesson_id ?? '—'}</td>
                      <td className="p-2">{r.score != null ? `${r.score}%` : '—'}</td>
                      <td className="p-2 text-xs text-text-muted max-w-[24rem] truncate" title={r.payload ? JSON.stringify(r.payload) : ''}>
                        {r.payload ? JSON.stringify(r.payload) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
