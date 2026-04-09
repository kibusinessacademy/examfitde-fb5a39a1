import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Pencil, Send, Calendar, Megaphone,
  Clock, CheckCircle, XCircle, AlertTriangle, Share2,
} from 'lucide-react';
import { toast } from 'sonner';

// Growth Content Queue
function useGrowthQueue() {
  return useQuery({
    queryKey: ['growth-content-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('growth_content_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

// Social Campaigns
function useSocialCampaigns() {
  return useQuery({
    queryKey: ['social-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase.from('social_campaigns').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// Social Content Items
function useSocialContent() {
  return useQuery({
    queryKey: ['social-content-items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('social_content_items').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
  });
}

// Lead Magnets
function useLeadMagnets() {
  return useQuery({
    queryKey: ['social-lead-magnets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('social_lead_magnets').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3 w-3 text-amber-500" />,
  posted: <CheckCircle className="h-3 w-3 text-emerald-500" />,
  failed: <XCircle className="h-3 w-3 text-rose-500" />,
  draft: <AlertTriangle className="h-3 w-3 text-muted-foreground" />,
};

function QueueTab() {
  const { data: items, isLoading } = useGrowthQueue();
  if (isLoading) return <Skeleton className="h-40" />;

  const stats = {
    pending: items?.filter(i => i.status === 'pending').length || 0,
    posted: items?.filter(i => i.status === 'posted').length || 0,
    failed: items?.filter(i => i.status === 'failed').length || 0,
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="py-2 px-3 text-center"><p className="text-lg font-bold text-amber-600">{stats.pending}</p><p className="text-[9px] text-muted-foreground">Ausstehend</p></CardContent></Card>
        <Card><CardContent className="py-2 px-3 text-center"><p className="text-lg font-bold text-emerald-600">{stats.posted}</p><p className="text-[9px] text-muted-foreground">Gepostet</p></CardContent></Card>
        <Card><CardContent className="py-2 px-3 text-center"><p className="text-lg font-bold text-rose-600">{stats.failed}</p><p className="text-[9px] text-muted-foreground">Fehler</p></CardContent></Card>
      </div>
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {(items || []).map(item => (
          <Card key={item.id} className="hover:bg-muted/20 transition-colors">
            <CardContent className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {statusIcons[item.status] || statusIcons.draft}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px]">{item.platform}</Badge>
                    <Badge variant="outline" className="text-[9px]">{item.channel}</Badge>
                    <Badge className={cn('text-[9px]',
                      item.status === 'posted' ? 'bg-emerald-500/15 text-emerald-600' :
                      item.status === 'failed' ? 'bg-rose-500/15 text-rose-600' : 'bg-amber-500/15 text-amber-600'
                    )}>{item.status}</Badge>
                  </div>
                  {item.post_url && <a href={item.post_url} target="_blank" rel="noopener" className="text-[10px] text-primary hover:underline truncate block">{item.post_url}</a>}
                  {item.error_message && <p className="text-[10px] text-rose-500 truncate">{item.error_message}</p>}
                </div>
              </div>
              <span className="text-[9px] text-muted-foreground shrink-0">{new Date(item.created_at).toLocaleDateString('de-DE')}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CampaignsTab() {
  const { data: campaigns, isLoading } = useSocialCampaigns();
  const qc = useQueryClient();
  const createCampaign = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('social_campaigns').insert({ name });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-campaigns'] }); toast.success('Kampagne erstellt'); },
    onError: (e: any) => toast.error(e.message),
  });
  const [newName, setNewName] = useState('');

  if (isLoading) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-[10px]">Neue Kampagne</Label>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Kampagnenname" className="h-8 text-xs" />
        </div>
        <Button size="sm" className="text-xs gap-1" onClick={() => { if (newName) { createCampaign.mutate(newName); setNewName(''); } }}>
          <Plus className="h-3 w-3" /> Erstellen
        </Button>
      </div>
      <div className="space-y-1">
        {(campaigns || []).map(c => (
          <Card key={c.id}>
            <CardContent className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">{c.name}</span>
              </div>
              <span className="text-[9px] text-muted-foreground">{new Date(c.created_at).toLocaleDateString('de-DE')}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function LeadMagnetsTab() {
  const { data: magnets, isLoading } = useLeadMagnets();
  const qc = useQueryClient();
  const createMagnet = useMutation({
    mutationFn: async (data: { title: string; description: string }) => {
      const { error } = await supabase.from('social_lead_magnets').insert(data);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['social-lead-magnets'] }); toast.success('Lead Magnet erstellt'); },
  });
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  if (isLoading) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Lead Magnet Titel" className="h-8 text-xs" />
          <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Beschreibung" rows={2} className="text-xs" />
          <Button size="sm" className="text-xs gap-1" onClick={() => { if (title) { createMagnet.mutate({ title, description: desc }); setTitle(''); setDesc(''); } }}>
            <Plus className="h-3 w-3" /> Erstellen
          </Button>
        </CardContent>
      </Card>
      {(magnets || []).map(m => (
        <Card key={m.id}>
          <CardContent className="py-2 px-4">
            <p className="text-xs font-semibold">{m.title}</p>
            {m.description && <p className="text-[10px] text-muted-foreground">{m.description}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function SocialMediaManager() {
  return (
    <Tabs defaultValue="queue" className="w-full">
      <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
        <TabsTrigger value="queue" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Share2 className="h-3 w-3" /> Content Queue</TabsTrigger>
        <TabsTrigger value="campaigns" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Megaphone className="h-3 w-3" /> Kampagnen</TabsTrigger>
        <TabsTrigger value="leads" className="text-xs py-1.5 gap-1 data-[state=active]:bg-background rounded-lg"><Calendar className="h-3 w-3" /> Lead Magnets</TabsTrigger>
      </TabsList>
      <TabsContent value="queue" className="mt-3"><QueueTab /></TabsContent>
      <TabsContent value="campaigns" className="mt-3"><CampaignsTab /></TabsContent>
      <TabsContent value="leads" className="mt-3"><LeadMagnetsTab /></TabsContent>
    </Tabs>
  );
}
