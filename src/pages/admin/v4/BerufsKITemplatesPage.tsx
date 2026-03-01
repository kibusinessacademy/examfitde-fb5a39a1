import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Palette, FileCode, Loader2, Star, Trash2, Save } from 'lucide-react';

function useTemplates() {
  return useQuery({
    queryKey: ['work-pdf-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_pdf_templates').select('*').order('name');
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

function useThemes() {
  return useQuery({
    queryKey: ['work-brand-themes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_brand_themes').select('*').order('brand_name');
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export default function BerufsKITemplatesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Template Manager</h1>
        <p className="text-muted-foreground">PDF-Templates & Brand-Themes für ExamFit@work-Produkte</p>
      </div>
      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates"><FileCode className="h-4 w-4 mr-1" />PDF-Templates</TabsTrigger>
          <TabsTrigger value="themes"><Palette className="h-4 w-4 mr-1" />Brand-Themes</TabsTrigger>
        </TabsList>
        <TabsContent value="templates" className="mt-4"><TemplatesSection /></TabsContent>
        <TabsContent value="themes" className="mt-4"><ThemesSection /></TabsContent>
      </Tabs>
    </div>
  );
}

function TemplatesSection() {
  const { data: templates = [], isLoading } = useTemplates();
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const qc = useQueryClient();

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('work_pdf_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Template gelöscht'); qc.invalidateQueries({ queryKey: ['work-pdf-templates'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('work_pdf_templates').update({ is_default: false }).neq('id', id);
      const { error } = await supabase.from('work_pdf_templates').update({ is_default: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Standard-Template gesetzt'); qc.invalidateQueries({ queryKey: ['work-pdf-templates'] }); },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const editing = editId ? templates.find((t: any) => t.id === editId) : null;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Neues Template</Button></DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>PDF-Template erstellen</DialogTitle></DialogHeader>
            <TemplateForm onSuccess={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>
      {templates.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Noch keine Templates vorhanden.</CardContent></Card>
      ) : (
        <div className="grid gap-4">
          {templates.map((t: any) => (
            <Card key={t.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.is_default && <Badge><Star className="h-3 w-3 mr-1" />Standard</Badge>}
                    <Badge variant="outline">v{t.version}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.description || t.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!t.is_default && <Button variant="outline" size="sm" onClick={() => setDefault.mutate(t.id)}><Star className="h-3 w-3 mr-1" />Standard</Button>}
                  <Dialog open={editId === t.id} onOpenChange={open => setEditId(open ? t.id : null)}>
                    <DialogTrigger asChild><Button variant="outline" size="sm">Bearbeiten</Button></DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader><DialogTitle>Template bearbeiten</DialogTitle></DialogHeader>
                      {editing && <TemplateForm template={editing} onSuccess={() => setEditId(null)} />}
                    </DialogContent>
                  </Dialog>
                  <Button variant="ghost" size="sm" onClick={() => deleteTemplate.mutate(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateForm({ template, onSuccess }: { template?: any; onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: template?.name || '', slug: template?.slug || '', description: template?.description || '',
    html_shell: template?.html_shell || '<!DOCTYPE html>\n<html>\n<head><style>{{CSS}}</style></head>\n<body>{{CONTENT}}</body>\n</html>',
    css: template?.css || '@page { size: A4; margin: 20mm; }',
    version: template?.version || 1, is_default: template?.is_default || false,
  });

  const save = useMutation({
    mutationFn: async () => {
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (template) {
        const { error } = await supabase.from('work_pdf_templates').update({
          name: form.name, slug, description: form.description || null,
          html_shell: form.html_shell, css: form.css, version: form.version, is_default: form.is_default,
        }).eq('id', template.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('work_pdf_templates').insert({
          name: form.name, slug, description: form.description || null,
          html_shell: form.html_shell, css: form.css, version: form.version, is_default: form.is_default,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(template ? 'Template aktualisiert' : 'Template erstellt'); qc.invalidateQueries({ queryKey: ['work-pdf-templates'] }); onSuccess(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><Label>Slug</Label><Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="auto" /></div>
        <div><Label>Version</Label><Input type="number" value={form.version} onChange={e => setForm(f => ({ ...f, version: parseInt(e.target.value) || 1 }))} /></div>
      </div>
      <div><Label>Beschreibung</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      <div>
        <Label>HTML Shell</Label>
        <Textarea className="font-mono text-xs min-h-[200px]" value={form.html_shell} onChange={e => setForm(f => ({ ...f, html_shell: e.target.value }))} />
      </div>
      <div>
        <Label>CSS</Label>
        <Textarea className="font-mono text-xs min-h-[200px]" value={form.css} onChange={e => setForm(f => ({ ...f, css: e.target.value }))} />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.is_default} onCheckedChange={v => setForm(f => ({ ...f, is_default: v }))} />
        <Label>Als Standard verwenden</Label>
      </div>
      <Button onClick={() => save.mutate()} disabled={!form.name || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {template ? 'Speichern' : 'Erstellen'}
      </Button>
    </div>
  );
}

function ThemesSection() {
  const { data: themes = [], isLoading } = useThemes();
  const [showCreate, setShowCreate] = useState(false);
  const qc = useQueryClient();

  const deleteTheme = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('work_brand_themes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Theme gelöscht'); qc.invalidateQueries({ queryKey: ['work-brand-themes'] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('work_brand_themes').update({ is_default: false }).neq('id', id);
      const { error } = await supabase.from('work_brand_themes').update({ is_default: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Standard-Theme gesetzt'); qc.invalidateQueries({ queryKey: ['work-brand-themes'] }); },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Neues Theme</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Brand-Theme erstellen</DialogTitle></DialogHeader>
            <ThemeForm onSuccess={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>
      {themes.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Noch keine Themes vorhanden.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {themes.map((t: any) => (
            <Card key={t.id}>
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.brand_name}</span>
                    {t.is_default && <Badge><Star className="h-3 w-3 mr-1" />Standard</Badge>}
                  </div>
                  <div className="flex gap-1">
                    {!t.is_default && <Button variant="outline" size="sm" onClick={() => setDefault.mutate(t.id)}><Star className="h-3 w-3" /></Button>}
                    <Button variant="ghost" size="sm" onClick={() => deleteTheme.mutate(t.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded border" style={{ backgroundColor: t.primary_color }} title="Primary" />
                  <div className="w-8 h-8 rounded border" style={{ backgroundColor: t.accent_color }} title="Accent" />
                  {t.secondary_color && <div className="w-8 h-8 rounded border" style={{ backgroundColor: t.secondary_color }} title="Secondary" />}
                </div>
                <p className="text-xs text-muted-foreground">{t.font_heading || 'System'} / {t.font_body || 'System'}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ThemeForm({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    brand_name: '', primary_color: '#1a56db', accent_color: '#f59e0b',
    secondary_color: '', font_heading: 'Inter', font_body: 'Inter',
    logo_url: '', footer_text: '', legal_notice: '', is_default: false,
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('work_brand_themes').insert({
        brand_name: form.brand_name, primary_color: form.primary_color, accent_color: form.accent_color,
        secondary_color: form.secondary_color || null, font_heading: form.font_heading || null,
        font_body: form.font_body || null, logo_url: form.logo_url || null,
        footer_text: form.footer_text || null, legal_notice: form.legal_notice || null, is_default: form.is_default,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Theme erstellt'); qc.invalidateQueries({ queryKey: ['work-brand-themes'] }); onSuccess(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <div><Label>Markenname *</Label><Input value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))} placeholder="ExamFit@work Premium" /></div>
      <div className="grid grid-cols-3 gap-4">
        <div><Label>Primärfarbe</Label><Input type="color" value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))} /></div>
        <div><Label>Akzentfarbe</Label><Input type="color" value={form.accent_color} onChange={e => setForm(f => ({ ...f, accent_color: e.target.value }))} /></div>
        <div><Label>Sekundärfarbe</Label><Input type="color" value={form.secondary_color || '#6b7280'} onChange={e => setForm(f => ({ ...f, secondary_color: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Font Heading</Label><Input value={form.font_heading} onChange={e => setForm(f => ({ ...f, font_heading: e.target.value }))} /></div>
        <div><Label>Font Body</Label><Input value={form.font_body} onChange={e => setForm(f => ({ ...f, font_body: e.target.value }))} /></div>
      </div>
      <div><Label>Logo URL</Label><Input value={form.logo_url} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} /></div>
      <div><Label>Footer-Text</Label><Input value={form.footer_text} onChange={e => setForm(f => ({ ...f, footer_text: e.target.value }))} placeholder="© ExamFit@work" /></div>
      <div><Label>Rechtlicher Hinweis</Label><Textarea value={form.legal_notice} onChange={e => setForm(f => ({ ...f, legal_notice: e.target.value }))} /></div>
      <div className="flex items-center gap-2">
        <Switch checked={form.is_default} onCheckedChange={v => setForm(f => ({ ...f, is_default: v }))} />
        <Label>Als Standard verwenden</Label>
      </div>
      <Button onClick={() => save.mutate()} disabled={!form.brand_name || save.isPending} className="w-full">
        {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Erstellen
      </Button>
    </div>
  );
}
