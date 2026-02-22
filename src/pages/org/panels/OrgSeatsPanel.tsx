import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SEAT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  INVITED: "bg-blue-100 text-blue-800",
  SUSPENDED: "bg-yellow-100 text-yellow-800",
  EXPIRED: "bg-gray-100 text-gray-600",
  REVOKED: "bg-red-100 text-red-800",
};

interface Props {
  organizationId: string;
  entities: any[];
  learners: any[];
  seats: any[];
  seatSummary: Record<string, number>;
}

export default function OrgSeatsPanel({ entities, seats, seatSummary }: Props) {
  const [entityFilter, setEntityFilter] = useState("all");

  const entityMap = useMemo(() => Object.fromEntries(entities.map(e => [e.id, e])), [entities]);

  const filteredSeats = entityFilter === "all"
    ? seats
    : seats.filter((s: any) => s.entity_id === entityFilter);

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Seats</CardDescription>
            <CardTitle className="text-3xl">{seatSummary.ACTIVE ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Eingeladen</CardDescription>
            <CardTitle className="text-3xl">{seatSummary.INVITED ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Gesamt Seats</CardDescription>
            <CardTitle className="text-3xl">{seats.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Auslastung</CardDescription>
            <CardTitle className="text-3xl">
              {seats.length > 0 ? Math.round(((seatSummary.ACTIVE ?? 0) / seats.length) * 100) : 0}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filter + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Seats & Lizenzen</CardTitle>
              <CardDescription>{filteredSeats.length} Seats</CardDescription>
            </div>
            {entities.length > 1 && (
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Alle Einheiten" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle Einheiten</SelectItem>
                  {entities.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredSeats.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Keine Seats vorhanden.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Learner</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Laufzeit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSeats.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.learner_user_id?.slice(0, 8)}…</TableCell>
                    <TableCell>{s.entity_id ? (entityMap[s.entity_id]?.display_name ?? "–") : "–"}</TableCell>
                    <TableCell>
                      <Badge className={SEAT_STATUS_COLORS[s.seat_status] ?? ""}>{s.seat_status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.start_at ?? "–"} → {s.end_at ?? "∞"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
