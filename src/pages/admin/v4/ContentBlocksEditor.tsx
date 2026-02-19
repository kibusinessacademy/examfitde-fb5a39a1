import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Edit, Trash2, CheckCircle2, Clock, Eye, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUIContentBlocks, useUIContentBlockMutations, type UIContentBlock } from '@/hooks/useUIContentBlocks';

const SCOPES = [
  { value: 'learner_dashboard', label: 'Learner Dashboard' },
  { value: 'course_overview', label: 'Kursübersicht' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'homepage', label: 'Homepage' },
  { value: 'exam_trainer', label: 'Prüfungstrainer' },
];

const PLACEMENTS = [
  { value: 'hero_top', label: 'Hero (oben)' },
  { value: 'sidebar_help', label: 'Sidebar Hilfe' },
  { value: 'footer_banner', label: 'Footer Banner' },
  { value: 'inline_cta', label: 'Inline CTA' },
];

const AUDIENCES = [
  { value: 'all', label: 'Alle' },
  { value: 'azubi', label: 'Auszubildende' },
  { value: 'betrieb', label: 'Betriebe' },
  { value: 'institution', label: 'Institutionen' },
];

function StatusBadge({ status }: { status: string }) {
  const isPublished = status === 'published';
  return (
    <Badge variant="outline" className={cn('text-[10px] gap-1',
      isPublished ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
    )}>
      {isPublished ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {status}
    </Badge>
  );
}

export default function ContentBlocksEditor() {
  const [scopeFilter, setScopeFilter] = useState<string>('');
  const { data: blocks = [], isLoading } = useUIContentBlocks(scopeFilter || undefined);
  const { create, update, remove } = useUIContentBlockMutations();
  const [editing, setEditing] = useState<Partial<UIContentBlock> | null>(null);

  const filtered = blocks;

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) {
      update.mutate(editing as UIContentBlock & { id: string });
    } else {
      create.mutate(editing);
    }
    setEditing(null);
  };

  const effectiveCopy = (b: Partial<UIContentBlock>) => b.manual_copy || b.generated_copy || '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Content Blocks</h1>
        <p className="text-sm text-muted-foreground mt-1">UI-Texte, CTAs & Bilder für den Learner-Bereich</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={scopeFilter} onValueChange={v => setScopeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Alle Scopes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Scopes</SelectItem>
            {SCOPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setEditing({
          scope: 'learner_dashboard', placement: 'hero_top', locale: 'de',
          audience: 'all', status: 'draft',
        })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Neuer Block
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Scope</th>
                <th className="text-left py-3 px-4">Placement</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Zielgruppe</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Text (effektiv)</th>
                <th className="text-left py-3 px-4">Status</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Keine Content Blocks gefunden</td></tr>
              ) : filtered.map(block => (
                <tr key={block.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2.5 px-4 text-xs font-mono">{block.scope}</td>
                  <td className="py-2.5 px-4 text-xs">{block.placement}</td>
                  <td className="py-2.5 px-4 text-xs hidden md:table-cell">{block.audience}</td>
                  <td className="py-2.5 px-4 text-xs hidden lg:table-cell max-w-[200px] truncate">
                    {effectiveCopy(block) || <span className="text-muted-foreground italic">Leer</span>}
                  </td>
                  <td className="py-2.5 px-4"><StatusBadge status={block.status} /></td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(block)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(block.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Block bearbeiten' : 'Neuer Content Block'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <Tabs defaultValue="manual" className="w-full">
              <TabsList>
                <TabsTrigger value="auto"><Layers className="h-3.5 w-3.5 mr-1" /> Auto (generiert)</TabsTrigger>
                <TabsTrigger value="manual"><Edit className="h-3.5 w-3.5 mr-1" /> Manuell</TabsTrigger>
                <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1" /> Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="auto" className="space-y-3 mt-4">
                <p className="text-xs text-muted-foreground">Vom System generierter Text (nur lesbar):</p>
                <div className="p-3 bg-muted/50 rounded-md text-sm min-h-[80px]">
                  {editing.generated_copy || <span className="text-muted-foreground italic">Kein generierter Text vorhanden</span>}
                </div>
              </TabsContent>

              <TabsContent value="manual" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Scope</label>
                    <Select value={editing.scope || 'learner_dashboard'} onValueChange={v => setEditing({ ...editing, scope: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SCOPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Placement</label>
                    <Select value={editing.placement || 'hero_top'} onValueChange={v => setEditing({ ...editing, placement: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLACEMENTS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Zielgruppe</label>
                    <Select value={editing.audience || 'all'} onValueChange={v => setEditing({ ...editing, audience: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {AUDIENCES.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Manueller Text (Override)</label>
                  <Textarea
                    value={editing.manual_copy || ''}
                    onChange={e => setEditing({ ...editing, manual_copy: e.target.value })}
                    rows={4}
                    placeholder="Leer lassen → generierter Text wird verwendet"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">CTA Label</label>
                    <Input value={editing.cta_label || ''} onChange={e => setEditing({ ...editing, cta_label: e.target.value })} placeholder="z.B. Jetzt starten" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">CTA URL</label>
                    <Input value={editing.cta_url || ''} onChange={e => setEditing({ ...editing, cta_url: e.target.value })} placeholder="/shop" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status || 'draft'} onValueChange={v => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Entwurf</SelectItem>
                      <SelectItem value="published">Veröffentlicht</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="preview" className="mt-4">
                <p className="text-xs text-muted-foreground mb-2">Effektiver Text (manual &gt; generated):</p>
                <Card>
                  <CardContent className="py-4">
                    <p className="text-sm">{effectiveCopy(editing) || <span className="text-muted-foreground italic">Kein Text</span>}</p>
                    {editing.cta_label && (
                      <Button size="sm" className="mt-3">{editing.cta_label}</Button>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button onClick={handleSave}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
