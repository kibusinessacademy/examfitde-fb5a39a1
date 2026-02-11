import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart3, FileText, Globe, Eye, CheckCircle, XCircle, RefreshCw,
  PenTool, Trash2, Send, Link2, Search, Filter, Plus
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';

// Type from DB
interface SEODocument {
  id: string;
  doc_type: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  status: string;
  qc_score: number;
  qc_report: Record<string, unknown> | null;
  beruf_id: string | null;
  curriculum_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SEOTemplate {
  id: string;
  template_key: string;
  doc_type: string;
  display_name: string;
  is_active: boolean;
}

export default function SEOContentHub() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch documents
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['seo-documents', statusFilter, typeFilter],
    queryFn: async () => {
      let query = supabase
        .from('seo_documents')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(200);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (typeFilter !== 'all') query = query.eq('doc_type', typeFilter);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as SEODocument[];
    },
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ['seo-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seo_templates')
        .select('id, template_key, doc_type, display_name, is_active')
        .eq('is_active', true)
        .order('doc_type');
      if (error) throw error;
      return (data || []) as SEOTemplate[];
    },
  });

  // Stats
  const stats = {
    total: documents.length,
    published: documents.filter(d => d.status === 'published').length,
    in_review: documents.filter(d => d.status === 'in_review').length,
    draft: documents.filter(d => d.status === 'draft').length,
    avgScore: documents.length > 0
      ? Math.round(documents.reduce((s, d) => s + (d.qc_score || 0), 0) / documents.length)
      : 0,
  };

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async (docId: string) => {
      const { data, error } = await supabase.functions.invoke('seo-publish', {
        body: { document_id: docId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Dokument veröffentlicht');
      queryClient.invalidateQueries({ queryKey: ['seo-documents'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // QC mutation
  const qcMutation = useMutation({
    mutationFn: async (docId: string) => {
      const { data, error } = await supabase.functions.invoke('seo-qc-check', {
        body: { document_id: docId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('QC Check abgeschlossen');
      queryClient.invalidateQueries({ queryKey: ['seo-documents'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Internal linking mutation
  const linkMutation = useMutation({
    mutationFn: async (docId: string) => {
      const { data, error } = await supabase.functions.invoke('seo-internal-linker', {
        body: { document_id: docId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(`Internal Linking: ${data?.documents_updated || 0} aktualisiert`);
      queryClient.invalidateQueries({ queryKey: ['seo-documents'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = documents.filter(d =>
    !searchTerm || d.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.slug.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'in_review': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'draft': return 'bg-muted text-muted-foreground';
      case 'archived': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return '';
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">SEO Content Hub</h1>
          <p className="text-muted-foreground">SSOT-basierte Content-Fabrik mit Quality Gates</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => linkMutation.mutate('')}>
            <Link2 className="h-4 w-4 mr-2" />
            Batch Linking
          </Button>
          <GenerateDialog templates={templates} onGenerated={() => queryClient.invalidateQueries({ queryKey: ['seo-documents'] })} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-xs text-muted-foreground">Gesamt</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{stats.published}</div>
          <div className="text-xs text-muted-foreground">Published</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{stats.in_review}</div>
          <div className="text-xs text-muted-foreground">In Review</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-2xl font-bold">{stats.draft}</div>
          <div className="text-xs text-muted-foreground">Draft</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className={`text-2xl font-bold ${scoreColor(stats.avgScore)}`}>{stats.avgScore}</div>
          <div className="text-xs text-muted-foreground">Ø QC Score</div>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="in_review">In Review</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Typ" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Typen</SelectItem>
            <SelectItem value="landing">Landing</SelectItem>
            <SelectItem value="blog">Blog</SelectItem>
            <SelectItem value="faq">FAQ</SelectItem>
            <SelectItem value="glossary">Glossar</SelectItem>
            <SelectItem value="product">Produkt</SelectItem>
            <SelectItem value="cluster">Cluster</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Documents Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Titel</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>QC</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Laden...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Keine Dokumente</TableCell></TableRow>
            ) : filtered.map(doc => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium max-w-[200px] truncate">{doc.title}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs">{doc.doc_type}</Badge>
                </TableCell>
                <TableCell>
                  <Badge className={statusColor(doc.status)}>{doc.status}</Badge>
                </TableCell>
                <TableCell>
                  <span className={`font-mono font-bold ${scoreColor(doc.qc_score)}`}>
                    {doc.qc_score}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono max-w-[150px] truncate">
                  /{doc.slug}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => qcMutation.mutate(doc.id)}
                      title="QC Check"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    {doc.status === 'in_review' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => publishMutation.mutate(doc.id)}
                        title="Publish"
                        className="text-green-400"
                      >
                        <Send className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => linkMutation.mutate(doc.id)}
                      title="Internal Linking"
                    >
                      <Link2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// Generate Dialog
function GenerateDialog({ templates, onGenerated }: { templates: SEOTemplate[]; onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [generating, setGenerating] = useState(false);

  // Load berufe for selection
  const { data: berufe = [] } = useQuery({
    queryKey: ['berufe-for-seo'],
    queryFn: async () => {
      const { data } = await supabase
        .from('berufe')
        .select('id, bezeichnung_kurz')
        .eq('ist_aktiv', true)
        .order('bezeichnung_kurz')
        .limit(100);
      return data || [];
    },
  });

  const [selectedBeruf, setSelectedBeruf] = useState('');

  const handleGenerate = async () => {
    if (!selectedTemplate || !selectedBeruf) {
      toast.error('Template und Beruf auswählen');
      return;
    }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('seo-generate', {
        body: {
          template_key: selectedTemplate,
          beruf_id: selectedBeruf,
        },
      });
      if (error) throw error;
      toast.success(`Dokument erstellt: ${data?.slug}`);
      onGenerated();
      setOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" />Generieren</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>SEO Content generieren</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Template</label>
            <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
              <SelectTrigger><SelectValue placeholder="Template wählen..." /></SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.template_key} value={t.template_key}>
                    {t.display_name} ({t.doc_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Beruf</label>
            <Select value={selectedBeruf} onValueChange={setSelectedBeruf}>
              <SelectTrigger><SelectValue placeholder="Beruf wählen..." /></SelectTrigger>
              <SelectContent>
                {berufe.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>{b.bezeichnung_kurz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleGenerate} disabled={generating} className="w-full">
            {generating ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <PenTool className="h-4 w-4 mr-2" />}
            {generating ? 'Wird generiert...' : 'Content generieren'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
