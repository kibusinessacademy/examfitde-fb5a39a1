import React, { useState } from 'react';
import { useContentAssets, useContentAssetMutations, type ContentAsset } from '@/hooks/useContentStudio';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2, Image, Search, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

function AssetForm({ asset, onSave, onClose }: {
  asset?: ContentAsset; onSave: (data: Partial<ContentAsset>) => void; onClose: () => void;
}) {
  const [form, setForm] = useState({
    file_path: asset?.file_path || '',
    file_name: asset?.file_name || '',
    alt_text: asset?.alt_text || '',
    caption: asset?.caption || '',
    keywords: asset?.keywords?.join(', ') || '',
    license: asset?.license || '',
    source_url: asset?.source_url || '',
  });

  const handleSubmit = () => {
    if (!form.file_path || !form.file_name) { toast.error('Pfad und Name sind Pflicht'); return; }
    onSave({
      ...form,
      keywords: form.keywords ? form.keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Dateiname *</Label>
          <Input value={form.file_name} onChange={e => setForm(f => ({ ...f, file_name: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Pfad *</Label>
          <Input value={form.file_path} onChange={e => setForm(f => ({ ...f, file_path: e.target.value }))} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Alt-Text (SEO-kritisch!)</Label>
        <Textarea value={form.alt_text} onChange={e => setForm(f => ({ ...f, alt_text: e.target.value }))} rows={2} placeholder="Beschreibender Alt-Text für Barrierefreiheit und SEO" />
        {!form.alt_text && <p className="text-[10px] text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Alt-Text fehlt – schlecht für SEO & Barrierefreiheit</p>}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Bildunterschrift</Label>
        <Input value={form.caption} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Keywords (kommagetrennt)</Label>
          <Input value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Lizenz</Label>
          <Input value={form.license} onChange={e => setForm(f => ({ ...f, license: e.target.value }))} placeholder="CC-BY, Eigen, etc." />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>Abbrechen</Button>
        <Button size="sm" onClick={handleSubmit}>{asset ? 'Speichern' : 'Erstellen'}</Button>
      </div>
    </div>
  );
}

export default function ContentAssetManager() {
  const { data: assets, isLoading } = useContentAssets();
  const { create, update, remove } = useContentAssetMutations();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) return <Skeleton className="h-40" />;

  const filtered = (assets || []).filter(a =>
    !search || a.file_name.toLowerCase().includes(search.toLowerCase()) || (a.alt_text || '').toLowerCase().includes(search.toLowerCase())
  );
  const missingAlt = (assets || []).filter(a => !a.alt_text).length;

  return (
    <div className="space-y-4">
      {missingAlt > 0 && (
        <Card className="border-l-4 border-l-amber-500 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span><strong>{missingAlt}</strong> Assets ohne Alt-Text – kritisch für SEO und Barrierefreiheit!</span>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Asset suchen..." className="pl-8 h-8 text-xs" />
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs gap-1"><Plus className="h-3 w-3" /> Neues Asset</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Neues Asset</DialogTitle></DialogHeader>
            <AssetForm onSave={data => create.mutate(data)} onClose={() => setShowCreate(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-1">
        {filtered.map(asset => (
          <Card key={asset.id} className="hover:bg-muted/20 transition-colors">
            <CardContent className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Image className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-semibold truncate block">{asset.file_name}</span>
                  <span className="text-[10px] text-muted-foreground truncate block">{asset.alt_text || '⚠ Kein Alt-Text'}</span>
                </div>
                {asset.alt_text ? (
                  <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="h-3 w-3" /></Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Asset bearbeiten</DialogTitle></DialogHeader>
                    <AssetForm asset={asset} onSave={data => update.mutate({ id: asset.id, ...data })} onClose={() => {}} />
                  </DialogContent>
                </Dialog>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(asset.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
