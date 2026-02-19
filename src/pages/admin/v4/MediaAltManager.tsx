import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, Edit, Trash2, AlertTriangle, CheckCircle2, Eye, Image,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaAssets, useMediaAssetMutations, type MediaAsset } from '@/hooks/useMediaAssets';

export default function MediaAltManager() {
  const { data: assets = [], isLoading } = useMediaAssets();
  const { create, update, remove } = useMediaAssetMutations();
  const [editing, setEditing] = useState<Partial<MediaAsset> | null>(null);
  const [filter, setFilter] = useState('');

  const missingAlt = assets.filter(a => !a.manual_alt && !a.generated_alt).length;
  const filtered = assets.filter(a =>
    a.file_name.toLowerCase().includes(filter.toLowerCase()) ||
    a.storage_path.toLowerCase().includes(filter.toLowerCase())
  );

  const effectiveAlt = (a: Partial<MediaAsset>) => a.manual_alt || a.generated_alt || '';
  const effectiveCaption = (a: Partial<MediaAsset>) => a.manual_caption || a.generated_caption || '';

  const handleSave = () => {
    if (!editing) return;
    if (editing.id) {
      update.mutate(editing as MediaAsset & { id: string });
    } else {
      create.mutate(editing);
    }
    setEditing(null);
  };

  const altWarnings = (a: Partial<MediaAsset>) => {
    const warnings: string[] = [];
    const alt = effectiveAlt(a);
    if (!alt) warnings.push('Alt-Text fehlt');
    else if (alt.length > 125) warnings.push('Alt-Text zu lang (>125 Zeichen)');
    return warnings;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Media & Alt-Text Manager</h1>
        <p className="text-sm text-muted-foreground mt-1">Bilder verwalten, Alt-Texte pflegen, SEO-Qualität sichern</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input placeholder="Assets durchsuchen…" value={filter} onChange={e => setFilter(e.target.value)} className="max-w-xs" />
        <Button size="sm" onClick={() => setEditing({ storage_path: '', file_name: '', used_on_pages: [] })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Asset hinzufügen
        </Button>
        {missingAlt > 0 && (
          <Badge variant="outline" className="text-yellow-600 bg-yellow-500/10">
            <AlertTriangle className="h-3 w-3 mr-1" /> {missingAlt} ohne Alt-Text
          </Badge>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left py-3 px-4">Datei</th>
                <th className="text-left py-3 px-4">Alt-Text (effektiv)</th>
                <th className="text-left py-3 px-4 hidden md:table-cell">Kontext</th>
                <th className="text-left py-3 px-4 hidden lg:table-cell">Verwendet auf</th>
                <th className="text-left py-3 px-4">SEO</th>
                <th className="text-right py-3 px-4">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Laden…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">
                  {assets.length === 0 ? 'Keine Assets vorhanden' : 'Keine Treffer'}
                </td></tr>
              ) : filtered.map(asset => {
                const warnings = altWarnings(asset);
                return (
                  <tr key={asset.id} className={cn("border-b border-border/50 hover:bg-muted/30", warnings.length > 0 && "bg-yellow-500/5")}>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <Image className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-xs font-medium truncate max-w-[150px]">{asset.file_name || 'Unbenannt'}</p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[150px]">{asset.storage_path}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs max-w-[200px] truncate">
                      {effectiveAlt(asset) || <span className="text-yellow-600">Fehlt!</span>}
                      {asset.manual_alt && <Badge variant="outline" className="ml-1 text-[9px]">Override</Badge>}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-muted-foreground hidden md:table-cell">{asset.context || '—'}</td>
                    <td className="py-2.5 px-4 text-xs hidden lg:table-cell">{(asset.used_on_pages || []).length || '—'}</td>
                    <td className="py-2.5 px-4">
                      {warnings.length === 0
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <AlertTriangle className="h-4 w-4 text-yellow-500" />}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(asset)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => remove.mutate(asset.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Editor Dialog */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Asset bearbeiten' : 'Neues Asset'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <Tabs defaultValue="edit" className="w-full">
              <TabsList>
                <TabsTrigger value="edit"><Edit className="h-3.5 w-3.5 mr-1" /> Bearbeiten</TabsTrigger>
                <TabsTrigger value="preview"><Eye className="h-3.5 w-3.5 mr-1" /> Preview</TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Dateiname</label>
                    <Input value={editing.file_name || ''} onChange={e => setEditing({ ...editing, file_name: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Storage-Pfad</label>
                    <Input value={editing.storage_path || ''} onChange={e => setEditing({ ...editing, storage_path: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Generierter Alt-Text</label>
                  <div className="p-2 bg-muted/50 rounded text-xs min-h-[32px]">
                    {editing.generated_alt || <span className="text-muted-foreground italic">Nicht vorhanden</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Manueller Alt-Text (Override)</label>
                  <Input
                    value={editing.manual_alt || ''}
                    onChange={e => setEditing({ ...editing, manual_alt: e.target.value })}
                    placeholder="Leer lassen → generierter Alt-Text"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">{(editing.manual_alt || editing.generated_alt || '').length}/125 Zeichen</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Generierte Caption</label>
                  <div className="p-2 bg-muted/50 rounded text-xs min-h-[32px]">
                    {editing.generated_caption || <span className="text-muted-foreground italic">Nicht vorhanden</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Manuelle Caption (Override)</label>
                  <Input
                    value={editing.manual_caption || ''}
                    onChange={e => setEditing({ ...editing, manual_caption: e.target.value })}
                    placeholder="Leer lassen → generierte Caption"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Primäres Keyword</label>
                    <Input value={editing.primary_keyword || ''} onChange={e => setEditing({ ...editing, primary_keyword: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Kontext</label>
                    <Input value={editing.context || ''} onChange={e => setEditing({ ...editing, context: e.target.value })} placeholder="z.B. landingpage.hero" />
                  </div>
                </div>
                {altWarnings(editing).length > 0 && (
                  <div className="p-2 bg-yellow-500/10 rounded-md">
                    {altWarnings(editing).map((w, i) => (
                      <p key={i} className="text-xs text-yellow-700 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> {w}
                      </p>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="preview" className="mt-4 space-y-3">
                <Card>
                  <CardContent className="py-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Effektiver Alt-Text:</p>
                    <p className="text-sm font-medium">{effectiveAlt(editing) || '(leer)'}</p>
                    <p className="text-xs text-muted-foreground mt-2">Effektive Caption:</p>
                    <p className="text-sm">{effectiveCaption(editing) || '(leer)'}</p>
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
