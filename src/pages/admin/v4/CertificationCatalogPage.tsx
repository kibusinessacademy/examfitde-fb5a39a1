import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, FileText, Search, Target, BookOpen, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import TrackBadge from '@/components/admin/TrackBadge';

const CATALOG_TYPES = [
  'Fortbildung_IHK', 'Fortbildung_HWK', 'Meister', 'Sachkunde',
  'Projektmanagement', 'Branchenzertifikat', 'Ausbildung', 'Sonstiges',
] as const;

const CHAMBER_TYPES = ['IHK', 'HWK', 'Staatlich', 'Privat'] as const;

const TYPE_COLORS: Record<string, string> = {
  Fortbildung_IHK: 'bg-primary/10 text-primary border-primary/30',
  Fortbildung_HWK: 'bg-primary/10 text-primary border-primary/30',
  Meister: 'bg-warning/10 text-warning border-warning/30',
  Sachkunde: 'bg-accent/10 text-accent-foreground border-accent/30',
  Projektmanagement: 'bg-info/10 text-info border-info/30',
  Branchenzertifikat: 'bg-muted text-muted-foreground border-border',
  Ausbildung: 'bg-success/10 text-success border-success/30',
  Sonstiges: 'bg-muted text-muted-foreground border-border',
};

interface CatalogEntry {
  id: string;
  title: string;
  slug: string;
  catalog_type: string;
  chamber_type: string;
  recognition_type: string;
  exam_format: { written?: boolean; oral?: boolean; presentation?: boolean; case_study?: boolean };
  track: string;
  min_question_target: number;
  priority_score: number;
  linked_certification_id: string | null;
  notes: string | null;
  created_at: string;
}

export default function CertificationCatalogPage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [chamberFilter, setChamberFilter] = useState('all');
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
  const [docUrl, setDocUrl] = useState('');
  const [docType, setDocType] = useState('rahmenplan');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const { data, error } = await (supabase as any)
      .from('certification_catalog')
      .select('*')
      .order('priority_score', { ascending: false });
    if (!error) setEntries(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (typeFilter !== 'all' && e.catalog_type !== typeFilter) return false;
      if (chamberFilter !== 'all' && e.chamber_type !== chamberFilter) return false;
      if (search && !e.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [entries, typeFilter, chamberFilter, search]);

  const stats = useMemo(() => {
    const byType: Record<string, number> = {};
    entries.forEach(e => { byType[e.catalog_type] = (byType[e.catalog_type] || 0) + 1; });
    const linked = entries.filter(e => e.linked_certification_id).length;
    return { total: entries.length, linked, byType };
  }, [entries]);

  const handleActivate = async (entry: CatalogEntry) => {
    setSubmitting(true);
    try {
      toast.info(`Zertifizierung "${entry.title}" wird angelegt…`);
      const { data: cert, error: certErr } = await (supabase as any)
        .from('german_certification_master')
        .insert({
          name: entry.title,
          slug: entry.slug,
          track: entry.track,
          cluster: entry.catalog_type,
          traeger: entry.chamber_type,
          pruefungsart: [
            entry.exam_format?.written && 'schriftlich',
            entry.exam_format?.oral && 'mündlich',
            entry.exam_format?.presentation && 'präsentation',
          ].filter(Boolean).join('+') || 'schriftlich',
          min_fragen_target: entry.min_question_target,
          oral_required: !!entry.exam_format?.oral,
          presentation_required: !!entry.exam_format?.presentation,
          case_study_required: !!entry.exam_format?.case_study,
        })
        .select('id')
        .single();
      if (certErr) throw certErr;

      await (supabase as any)
        .from('certification_catalog')
        .update({ linked_certification_id: cert.id })
        .eq('id', entry.id);

      toast.success(`"${entry.title}" als Zertifizierung angelegt`);
      load();
    } catch (err: any) {
      toast.error(`Aktivierung fehlgeschlagen: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddSource = (entry: CatalogEntry) => {
    setSelectedEntry(entry);
    setDocUrl('');
    setDocType('rahmenplan');
    setDocDialogOpen(true);
  };

  const handleSubmitSource = async () => {
    if (!selectedEntry || !docUrl.trim()) return;
    if (!selectedEntry.linked_certification_id) {
      toast.error('Bitte zuerst „Aktivieren" klicken, um eine Zertifizierung anzulegen.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await (supabase as any)
        .from('certification_documents')
        .insert({
          certification_id: selectedEntry.linked_certification_id,
          doc_type: docType,
          source_kind: 'url',
          source_url: docUrl.trim(),
          status: 'active',
          legal_priority: docType === 'verordnung' ? 100 : docType === 'rahmenplan' ? 80 : 60,
        });
      if (error) throw error;
      toast.success(`Quelle für "${selectedEntry.title}" registriert`);
      setDocDialogOpen(false);
    } catch (err: any) {
      toast.error(`Fehler: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Gesamt</p>
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aktiviert</p>
            <p className="text-2xl font-bold text-success">{stats.linked}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">IHK Fortbildung</p>
            <p className="text-2xl font-bold text-primary">{stats.byType['Fortbildung_IHK'] || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Meister</p>
            <p className="text-2xl font-bold text-warning">{stats.byType['Meister'] || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44 h-9">
            <SelectValue placeholder="Kategorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien</SelectItem>
            {CATALOG_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={chamberFilter} onValueChange={setChamberFilter}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="Kammer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kammern</SelectItem>
            {CHAMBER_TYPES.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zertifizierung</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Kammer</TableHead>
                <TableHead>Track</TableHead>
                <TableHead className="text-right">Fragen-Ziel</TableHead>
                <TableHead className="text-right">Priorität</TableHead>
                <TableHead>Format</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(entry => {
                const fmt = entry.exam_format || {};
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{entry.title}</span>
                        {entry.linked_certification_id && (
                          <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">aktiv</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[entry.catalog_type] || ''}`}>
                        {entry.catalog_type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{entry.chamber_type}</TableCell>
                    <TableCell>
                      <TrackBadge track={entry.track} />
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">{entry.min_question_target}</TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-mono ${entry.priority_score >= 85 ? 'text-success font-bold' : entry.priority_score >= 70 ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {entry.priority_score}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-0.5">
                        {fmt.written && <Badge variant="outline" className="text-[9px] px-1">S</Badge>}
                        {fmt.oral && <Badge variant="outline" className="text-[9px] px-1">M</Badge>}
                        {fmt.presentation && <Badge variant="outline" className="text-[9px] px-1">P</Badge>}
                        {fmt.case_study && <Badge variant="outline" className="text-[9px] px-1">F</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleAddSource(entry)}
                        >
                          <FileText className="h-3 w-3 mr-1" />
                          Quelle
                        </Button>
                        {!entry.linked_certification_id && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => handleActivate(entry)}
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Aktivieren
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        S = Schriftlich · M = Mündlich · P = Präsentation · F = Fallstudie
      </p>

      {/* Add Source Dialog */}
      <Dialog open={docDialogOpen} onOpenChange={setDocDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quelle hinzufügen: {selectedEntry?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">PDF-URL / Webseite</label>
              <Input
                placeholder="https://www.gesetze-im-internet.de/…"
                value={docUrl}
                onChange={e => setDocUrl(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Empfohlene Quellen: gesetze-im-internet.de, DIHK, IHK-Portale
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Dokumenttyp</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="verordnung">Verordnung (höchste Priorität)</SelectItem>
                  <SelectItem value="rahmenplan">Rahmenplan</SelectItem>
                  <SelectItem value="pruefungsordnung">Prüfungsordnung</SelectItem>
                  <SelectItem value="sonstiges">Sonstiges</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocDialogOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSubmitSource} disabled={!docUrl.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
              Registrieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
