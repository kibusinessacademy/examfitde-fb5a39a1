import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Link2, ArrowRight, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface LinkSuggestion {
  id: string;
  source_url: string;
  source_title: string | null;
  target_url: string;
  target_title: string | null;
  anchor_text: string | null;
  relevance_score: number;
  priority: number;
  reason: string | null;
  status: string;
  created_at: string;
}

export default function InternalLinkManager() {
  const qc = useQueryClient();
  const { data: links = [], isLoading } = useQuery({
    queryKey: ['seo-internal-links'],
    queryFn: async () => {
      const { data, error } = await supabase.from('seo_internal_link_suggestions' as any)
        .select('*').order('relevance_score', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as LinkSuggestion[];
    },
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState('all');

  const addMutation = useMutation({
    mutationFn: async (link: Record<string, any>) => {
      const { error } = await supabase.from('seo_internal_link_suggestions' as any).insert({
        source_url: link.source_url,
        source_title: link.source_title || null,
        target_url: link.target_url,
        target_title: link.target_title || null,
        anchor_text: link.anchor_text || null,
        relevance_score: parseInt(link.relevance_score) || 50,
        priority: parseInt(link.priority) || 5,
        reason: link.reason || null,
        status: 'suggested',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-internal-links'] });
      setShowAdd(false);
      setForm({});
      toast.success('Link-Vorschlag erstellt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('seo_internal_link_suggestions' as any)
        .update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-internal-links'] });
      toast.success('Status aktualisiert');
    },
  });

  const filtered = filter === 'all' ? links : links.filter(l => l.status === filter);

  if (isLoading) return <Card><CardContent className="py-10"><Skeleton className="h-40 w-full" /></CardContent></Card>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-primary">{links.length}</div>
          <div className="text-xs text-muted-foreground">Gesamt</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-amber-500">{links.filter(l => l.status === 'suggested').length}</div>
          <div className="text-xs text-muted-foreground">Vorgeschlagen</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-blue-500">{links.filter(l => l.status === 'approved').length}</div>
          <div className="text-xs text-muted-foreground">Freigegeben</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center">
          <div className="text-2xl font-bold text-emerald-500">{links.filter(l => l.status === 'implemented').length}</div>
          <div className="text-xs text-muted-foreground">Umgesetzt</div>
        </CardContent></Card>
      </div>

      <div className="flex justify-between items-center gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="suggested">Vorgeschlagen</SelectItem>
            <SelectItem value="approved">Freigegeben</SelectItem>
            <SelectItem value="implemented">Umgesetzt</SelectItem>
            <SelectItem value="rejected">Abgelehnt</SelectItem>
          </SelectContent>
        </Select>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 text-xs gap-1"><Plus className="h-3 w-3" /> Link-Vorschlag</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="text-sm">Neuer Link-Vorschlag</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Quell-URL *</Label>
                <Input value={form.source_url || ''} onChange={e => setForm({ ...form, source_url: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Quell-Titel</Label>
                <Input value={form.source_title || ''} onChange={e => setForm({ ...form, source_title: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Ziel-URL *</Label>
                <Input value={form.target_url || ''} onChange={e => setForm({ ...form, target_url: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Ziel-Titel</Label>
                <Input value={form.target_title || ''} onChange={e => setForm({ ...form, target_title: e.target.value })} className="h-8 text-xs" /></div>
              <div><Label className="text-xs">Anchor Text</Label>
                <Input value={form.anchor_text || ''} onChange={e => setForm({ ...form, anchor_text: e.target.value })} className="h-8 text-xs" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Relevanz (0-100)</Label>
                  <Input type="number" value={form.relevance_score || '50'} onChange={e => setForm({ ...form, relevance_score: e.target.value })} className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Priorität (1-10)</Label>
                  <Input type="number" value={form.priority || '5'} onChange={e => setForm({ ...form, priority: e.target.value })} className="h-8 text-xs" /></div>
              </div>
              <div><Label className="text-xs">Begründung</Label>
                <Input value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} className="h-8 text-xs" /></div>
              <Button size="sm" className="w-full" disabled={!form.source_url || !form.target_url || addMutation.isPending}
                onClick={() => addMutation.mutate(form)}>
                {addMutation.isPending ? 'Speichern...' : 'Vorschlag speichern'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-xs text-muted-foreground">
            Keine Link-Vorschläge vorhanden.
          </CardContent></Card>
        )}
        {filtered.map(link => (
          <Card key={link.id} className="hover:border-primary/30 transition-colors">
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="truncate max-w-[150px] text-muted-foreground">{link.source_title || link.source_url}</span>
                <ArrowRight className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate max-w-[150px] font-medium">{link.target_title || link.target_url}</span>
                {link.anchor_text && <Badge variant="secondary" className="text-[10px]">"{link.anchor_text}"</Badge>}
                <span className="ml-auto text-[10px] text-muted-foreground">Rel: {link.relevance_score}</span>
              </div>
              {link.status === 'suggested' && (
                <div className="flex gap-1 mt-2">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1"
                    onClick={() => updateStatus.mutate({ id: link.id, status: 'approved' })}>
                    <CheckCircle className="h-3 w-3" /> Freigeben
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-destructive"
                    onClick={() => updateStatus.mutate({ id: link.id, status: 'rejected' })}>
                    <XCircle className="h-3 w-3" /> Ablehnen
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
