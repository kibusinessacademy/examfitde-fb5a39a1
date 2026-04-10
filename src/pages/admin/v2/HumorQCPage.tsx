import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle2, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

type HumorQCRow = {
  certification_id: string;
  certification_title: string;
  total: number;
  approved_count: number;
  draft_count: number;
  rejected_count: number;
  avg_quality: number;
  pct_no_competence: number;
  pct_no_lesson: number;
  type_distribution: Record<string, number>;
  duplicate_suspect_count: number;
};

const TARGET = 365;

const TYPE_LABELS: Record<string, string> = {
  wordplay: 'Wortspiel',
  everyday_situation: 'Alltagssituation',
  exam_stress: 'Prüfungsstress',
  self_irony: 'Selbstironie',
  micro_tip: 'Micro-Tipp',
};

export default function HumorQCPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'humor-qc'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_humor_qc' as any)
        .select('*');
      if (error) throw error;
      return (data ?? []) as unknown as HumorQCRow[];
    },
  });

  const totalApproved = data?.reduce((s, r) => s + r.approved_count, 0) ?? 0;
  const totalDupes = data?.reduce((s, r) => s + r.duplicate_suspect_count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/command"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Leitstelle
        </Link>
        <h1 className="text-xl font-bold">Humor QC Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bestandsübersicht & Qualitätskontrolle aller Humor-Items
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Gesamt approved</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{totalApproved}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Zertifizierungen</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">{data?.length ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground">Ø Quality</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className="text-2xl font-bold">
              {data && data.length > 0
                ? (data.reduce((s, r) => s + (r.avg_quality ?? 0), 0) / data.length).toFixed(1)
                : '–'}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Dubletten
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <span className={`text-2xl font-bold ${totalDupes > 0 ? 'text-destructive' : ''}`}>
              {totalDupes}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* Per-certification table */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Lade QC-Daten…</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zertifizierung</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Ziel</TableHead>
                  <TableHead>Fortschritt</TableHead>
                  <TableHead className="text-right">Ø Score</TableHead>
                  <TableHead className="text-right">Dubletten</TableHead>
                  <TableHead className="text-right">% ohne Kompetenz</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map(row => {
                  const pct = Math.min(100, Math.round((row.approved_count / TARGET) * 100));
                  const healthy = row.approved_count >= TARGET && row.duplicate_suspect_count === 0;
                  return (
                    <TableRow key={row.certification_id}>
                      <TableCell className="font-medium text-sm max-w-[200px] truncate">
                        {healthy ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline mr-1" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 inline mr-1" />
                        )}
                        {row.certification_title ?? row.certification_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.approved_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{TARGET}</TableCell>
                      <TableCell className="w-32">
                        <Progress value={pct} className="h-2" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.avg_quality}</TableCell>
                      <TableCell className="text-right">
                        {row.duplicate_suspect_count > 0 ? (
                          <Badge variant="destructive" className="text-xs">{row.duplicate_suspect_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.pct_no_competence}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Type distribution per certification */}
      {data && data.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-4 w-4" /> Typ-Verteilung (approved)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.map(row => (
                <div key={row.certification_id}>
                  <p className="text-xs font-medium mb-1 truncate">
                    {row.certification_title ?? row.certification_id.slice(0, 8)}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(row.type_distribution || {}).map(([type, count]) => (
                      <Badge key={type} variant="secondary" className="text-[10px]">
                        {TYPE_LABELS[type] ?? type}: {count as number}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
