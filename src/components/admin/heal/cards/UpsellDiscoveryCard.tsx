/**
 * Track M3 — Co-Purchase Upsell Discovery + Owner-Digest History.
 * Admin-only UI in HealCockpit (Notification-Sektion).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, CheckCircle2, XCircle, RefreshCw, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function UpsellDiscoveryCard() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const suggestions = useQuery({
    queryKey: ["m3-upsell-suggestions", status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_upsell_suggestions", {
        p_status: status, p_limit: 50,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const digests = useQuery({
    queryKey: ["m3-org-digest-history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_get_org_digest_history", {
        p_period: "all", p_limit: 30,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const smoke = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("admin_smoke_track_m3");
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => toast.success(`Smoke ${d?.ok ? "✅" : "❌"} – Intents ${d?.intents_present}/2`),
    onError: (e: any) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const { data, error } = await supabase.rpc("admin_review_upsell_suggestion", {
        p_id: id, p_action: action,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast.success(`Suggestion ${v.action === "approve" ? "approved" : "rejected"}`);
      qc.invalidateQueries({ queryKey: ["m3-upsell-suggestions"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" /> Track M3 — Upsell Discovery + Owner Digest
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => smoke.mutate()} disabled={smoke.isPending}>
            <RefreshCw className="mr-1 h-3 w-3" /> Smoke
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="upsell">
          <TabsList>
            <TabsTrigger value="upsell">
              Upsell Suggestions <Badge variant="secondary" className="ml-2">{suggestions.data?.length ?? 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="digests">
              <Mail className="mr-1 h-3 w-3" /> Owner Digests <Badge variant="secondary" className="ml-2">{digests.data?.length ?? 0}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upsell" className="mt-4">
            <div className="mb-3 flex gap-2">
              {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
                  {s}
                </Button>
              ))}
            </div>
            {suggestions.isLoading ? (
              <p className="text-muted-foreground text-sm">Lädt…</p>
            ) : (suggestions.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">Keine Suggestions im Status „{status}". Discovery läuft Mo 04:15 UTC.</p>
            ) : (
              <div className="space-y-2">
                {(suggestions.data ?? []).map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {s.source_title ?? s.source_curriculum_id} → {s.target_title ?? s.target_curriculum_id}
                      </div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        Support {s.support_count} / {s.source_buyer_count} · Confidence {(s.confidence * 100).toFixed(1)}% · Lift {Number(s.lift).toFixed(2)}
                      </div>
                    </div>
                    {s.status === "pending" && (
                      <div className="ml-3 flex gap-1">
                        <Button size="sm" variant="default" onClick={() => review.mutate({ id: s.id, action: "approve" })}>
                          <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => review.mutate({ id: s.id, action: "reject" })}>
                          <XCircle className="mr-1 h-3 w-3" /> Reject
                        </Button>
                      </div>
                    )}
                    {s.status !== "pending" && <Badge variant="outline" className="ml-3">{s.status}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="digests" className="mt-4">
            {digests.isLoading ? (
              <p className="text-muted-foreground text-sm">Lädt…</p>
            ) : (digests.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">Noch keine Digests gesendet. Wöchentlich Mo 08:00 UTC, monatlich am 1. um 09:00 UTC.</p>
            ) : (
              <div className="space-y-2">
                {(digests.data ?? []).map((d: any) => (
                  <div key={d.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{d.org_name ?? d.org_id}</div>
                      <Badge variant="outline">{d.period}</Badge>
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      {d.period_start} → {d.period_end} · {d.recipients_count} Empfänger
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div>Lizenzen: <b>{d.payload?.active_licenses ?? 0}</b></div>
                      <div>Seats: <b>{d.payload?.seats_used ?? 0}/{d.payload?.total_seats ?? 0}</b></div>
                      <div>Aktive Lerner: <b>{d.payload?.active_learners ?? 0}</b></div>
                      <div>Ablaufend 30d: <b>{d.payload?.expiring_30d ?? 0}</b></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
