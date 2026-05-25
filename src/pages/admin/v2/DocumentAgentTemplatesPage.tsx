/**
 * Admin: Document Agent Templates — read-only Übersicht (Phase 1).
 * CRUD-Editor folgt in Phase 2 (Templates derzeit per Migration/Seed).
 */
import { useEffect, useState } from "react";
import { adminListTemplates } from "@/lib/document-agent/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function DocumentAgentTemplatesPage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof adminListTemplates>>>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    adminListTemplates().then(setRows).catch((e) => setErr((e as Error).message));
  }, []);
  return (
    <div className="container py-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Dokumenten-Agent · Templates</h1>
        <p className="text-sm text-muted-foreground">
          Berufsbezogene Dokumentvorlagen. CRUD-Editor folgt in Phase 2.
        </p>
      </header>
      {err && <p className="text-sm text-status-fg-danger">{err}</p>}
      <Card>
        <CardHeader><CardTitle className="text-base">Aktive Templates ({rows.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titel</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Risiko</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Review</TableHead>
                <TableHead className="text-right">Runs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title}<div className="text-xs text-muted-foreground">{r.slug}</div></TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell><Badge variant="outline">{r.risk_level}</Badge></TableCell>
                  <TableCell>{r.tier_required}</TableCell>
                  <TableCell>{r.review_required ? "Pflicht" : "—"}</TableCell>
                  <TableCell className="text-right">{r.runs_total}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
