import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRegulatoryUpdates, useRegulatoryImpact, useRegulatoryAction } from "@/hooks/useRegulatoryMonitor";
import { formatDateTime } from "@/components/admin/lib/admin-utils";
import { AlertTriangle, CheckCircle, Clock, ShieldAlert, RefreshCw, XCircle, Play, Eye } from "lucide-react";
import { toast } from "sonner";

const severityConfig: Record<string, { label: string; class: string }> = {
  critical: { label: "Kritisch", class: "bg-destructive text-destructive-foreground" },
  high: { label: "Hoch", class: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  medium: { label: "Mittel", class: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  low: { label: "Niedrig", class: "bg-muted text-muted-foreground" },
};

const statusConfig: Record<string, { label: string; icon: typeof AlertTriangle; class: string }> = {
  suspended: { label: "Gesperrt", icon: ShieldAlert, class: "text-destructive" },
  outdated: { label: "Veraltet", icon: AlertTriangle, class: "text-amber-400" },
  review_needed: { label: "Review nötig", icon: Eye, class: "text-amber-300" },
  up_to_date: { label: "Aktuell", icon: CheckCircle, class: "text-emerald-400" },
};

export default function RegulatoryPage() {
  const { data: updates = [], isLoading: loadingUpdates } = useRegulatoryUpdates();
  const { data: impact = [], isLoading: loadingImpact } = useRegulatoryImpact();
  const { processUpdates, markFalsePositive, overrideStatus } = useRegulatoryAction();
  const [activeTab, setActiveTab] = useState("inbox");

  const pendingUpdates = updates.filter((u) => !u.processed);
  const processedUpdates = updates.filter((u) => u.processed);

  const handleProcess = async () => {
    try {
      const result = await processUpdates.mutateAsync();
      toast.success(`${result?.processed ?? 0} Updates verarbeitet`);
    } catch {
      toast.error("Verarbeitung fehlgeschlagen");
    }
  };

  const handleFalsePositive = async (id: string) => {
    try {
      await markFalsePositive.mutateAsync(id);
      toast.success("Als False Positive markiert");
    } catch {
      toast.error("Fehler beim Markieren");
    }
  };

  const handleOverride = async (packageId: string, status: string) => {
    try {
      await overrideStatus.mutateAsync({ packageId, status });
      toast.success("Status aktualisiert");
    } catch {
      toast.error("Fehler beim Aktualisieren");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Regulatory Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Regulatorische Änderungen erkennen, bewerten und Maßnahmen steuern
          </p>
        </div>
        <Button onClick={handleProcess} disabled={processUpdates.isPending || pendingUpdates.length === 0} size="sm">
          <Play className="h-4 w-4 mr-1" />
          {pendingUpdates.length} Updates verarbeiten
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard title="Inbox" value={pendingUpdates.length} icon={Clock} variant={pendingUpdates.length > 0 ? "warning" : "default"} />
        <SummaryCard title="Impact" value={impact.length} icon={AlertTriangle} variant={impact.length > 0 ? "danger" : "default"} />
        <SummaryCard title="Gesperrt" value={impact.filter((i) => i.regulatory_status === "suspended").length} icon={ShieldAlert} variant="danger" />
        <SummaryCard title="Verarbeitet" value={processedUpdates.length} icon={CheckCircle} variant="default" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox">
            Inbox {pendingUpdates.length > 0 && <Badge variant="destructive" className="ml-1.5 text-xs px-1.5">{pendingUpdates.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="impact">
            Impact {impact.length > 0 && <Badge variant="outline" className="ml-1.5 text-xs px-1.5">{impact.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        {/* ── INBOX ── */}
        <TabsContent value="inbox" className="space-y-4">
          {loadingUpdates ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Lade Updates…</CardContent></Card>
          ) : pendingUpdates.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Keine ausstehenden regulatorischen Updates</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Titel</TableHead>
                    <TableHead>Quelle</TableHead>
                    <TableHead>Themen</TableHead>
                    <TableHead>Gesetz</TableHead>
                    <TableHead>Erkannt</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingUpdates.map((u) => {
                    const sev = severityConfig[u.severity] || severityConfig.low;
                    return (
                      <TableRow key={u.id}>
                        <TableCell><Badge className={sev.class}>{sev.label}</Badge></TableCell>
                        <TableCell className="font-medium max-w-[250px] truncate">{u.title}</TableCell>
                        <TableCell className="text-muted-foreground">{u.source}</TableCell>
                        <TableCell className="max-w-[150px]">
                          <div className="flex flex-wrap gap-1">
                            {(u.affected_topics || []).slice(0, 3).map((t) => (
                              <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{u.legal_reference || "–"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.detected_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => handleFalsePositive(u.id)} title="False Positive">
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ── IMPACT ── */}
        <TabsContent value="impact" className="space-y-4">
          {loadingImpact ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Lade Impact-Daten…</CardContent></Card>
          ) : impact.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Keine betroffenen Pakete</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Paket-ID</TableHead>
                    <TableHead>Grund</TableHead>
                    <TableHead>Auto-Aktion</TableHead>
                    <TableHead>Letzte Prüfung</TableHead>
                    <TableHead className="text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impact.map((item) => {
                    const sc = statusConfig[item.regulatory_status] || statusConfig.review_needed;
                    const Icon = sc.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className={`flex items-center gap-1.5 ${sc.class}`}>
                            <Icon className="h-4 w-4" />
                            <span className="text-sm font-medium">{sc.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.package_id.slice(0, 8)}…</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{item.staleness_reason || "–"}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{item.auto_action_taken || "–"}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(item.last_checked_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex gap-1 justify-end">
                            {item.regulatory_status !== "up_to_date" && (
                              <Button size="sm" variant="outline" onClick={() => handleOverride(item.package_id, "up_to_date")} title="Als aktuell markieren">
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {item.regulatory_status === "suspended" && (
                              <Button size="sm" variant="outline" onClick={() => handleOverride(item.package_id, "review_needed")} title="Sperre aufheben">
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        {/* ── AUDIT ── */}
        <TabsContent value="audit" className="space-y-4">
          {processedUpdates.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Noch keine verarbeiteten Updates</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Titel</TableHead>
                    <TableHead>Aktion</TableHead>
                    <TableHead>Betroffene Pakete</TableHead>
                    <TableHead>Verarbeitet am</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedUpdates.map((u) => {
                    const sev = severityConfig[u.severity] || severityConfig.low;
                    const impactCount = u.impact_analysis?.affected_packages ?? "–";
                    return (
                      <TableRow key={u.id}>
                        <TableCell><Badge className={sev.class}>{sev.label}</Badge></TableCell>
                        <TableCell className="font-medium max-w-[300px] truncate">{u.title}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{u.auto_action || "–"}</Badge></TableCell>
                        <TableCell className="text-center">{impactCount}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.processed_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ title, value, icon: Icon, variant }: { title: string; value: number; icon: typeof Clock; variant: "default" | "warning" | "danger" }) {
  const colorClass =
    variant === "danger" ? "text-destructive" :
    variant === "warning" ? "text-amber-400" :
    "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${colorClass}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
