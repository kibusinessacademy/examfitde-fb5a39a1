import { useState } from "react";
import { format, addMonths } from "date-fns";
import { Ban, Play, Pause, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AdminSheet,
  AdminSheetContent,
  AdminSheetHeader,
  AdminSheetTitle,
  AdminSheetDescription,
} from "@/components/admin/AdminSheet";
import { StandaloneLicenseDeviceTable } from "./StandaloneLicenseDeviceTable";
import { StandaloneLicenseEventFeed } from "./StandaloneLicenseEventFeed";
import {
  useLicenseDevices,
  useLicenseEvents,
  useUpdateLicenseStatus,
  useRemoveDevice,
  useExtendLicense,
  type StandaloneLicense,
} from "@/hooks/useStandaloneLicenses";

interface Props {
  license: StandaloneLicense | null;
  onClose: () => void;
}

export function StandaloneLicenseDetailSheet({ license, onClose }: Props) {
  const [tab, setTab] = useState("overview");

  const { data: devices = [], isLoading: devLoading } = useLicenseDevices(
    license?.license_id ?? null,
  );
  const { data: events = [], isLoading: evtLoading } = useLicenseEvents(
    license?.license_id ?? null,
  );

  const updateStatus = useUpdateLicenseStatus();
  const removeDevice = useRemoveDevice();
  const extendLicense = useExtendLicense();

  if (!license) return null;

  const handleStatusChange = (next: string) => {
    const reason = window.prompt("Grund (optional):");
    updateStatus.mutate({
      license_id: license.license_id,
      next_status: next,
      reason: reason || undefined,
    });
  };

  const handleExtend = () => {
    const newExpiry = addMonths(new Date(license.expires_at ?? new Date()), 3).toISOString();
    extendLicense.mutate({ license_id: license.license_id, expires_at: newExpiry });
  };

  const isMutating = updateStatus.isPending || extendLicense.isPending;

  return (
    <AdminSheet open={!!license} onOpenChange={(open) => !open && onClose()}>
      <AdminSheetContent className="sm:max-w-lg">
        <AdminSheetHeader>
          <AdminSheetTitle className="flex items-center gap-2">
            {license.email}
            <Badge variant="outline" className="text-xs">
              {license.status}
            </Badge>
          </AdminSheetTitle>
          <AdminSheetDescription>
            {license.course_title} · {license.package_title}
          </AdminSheetDescription>
        </AdminSheetHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">Übersicht</TabsTrigger>
            <TabsTrigger value="devices" className="flex-1">
              Geräte ({devices.length})
            </TabsTrigger>
            <TabsTrigger value="events" className="flex-1">
              Events ({events.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Lizenz-ID" value={license.license_id} mono />
              <Detail label="Risiko" value={license.risk_level} />
              <Detail label="Geräte" value={`${license.device_count}/${license.device_limit}`} />
              <Detail
                label="Ablauf"
                value={
                  license.expires_at
                    ? format(new Date(license.expires_at), "dd.MM.yyyy")
                    : "—"
                }
              />
              <Detail
                label="Letzte Validierung"
                value={
                  license.last_validated_at
                    ? format(new Date(license.last_validated_at), "dd.MM.yy HH:mm")
                    : "—"
                }
              />
              <Detail
                label="Ausgestellt"
                value={format(new Date(license.issued_at), "dd.MM.yyyy")}
              />
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              {license.status === "active" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStatusChange("suspended")}
                    disabled={isMutating}
                  >
                    <Pause className="mr-1 h-3 w-3" /> Suspendieren
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleStatusChange("revoked")}
                    disabled={isMutating}
                  >
                    <Ban className="mr-1 h-3 w-3" /> Widerrufen
                  </Button>
                </>
              )}
              {license.status === "suspended" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStatusChange("active")}
                    disabled={isMutating}
                  >
                    <Play className="mr-1 h-3 w-3" /> Reaktivieren
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleStatusChange("revoked")}
                    disabled={isMutating}
                  >
                    <Ban className="mr-1 h-3 w-3" /> Widerrufen
                  </Button>
                </>
              )}
              {license.status === "revoked" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleStatusChange("active")}
                  disabled={isMutating}
                >
                  <Play className="mr-1 h-3 w-3" /> Reaktivieren
                </Button>
              )}
              {license.status === "expired" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExtend}
                  disabled={isMutating}
                >
                  <Calendar className="mr-1 h-3 w-3" /> +3 Monate
                </Button>
              )}
              {license.status !== "expired" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExtend}
                  disabled={isMutating}
                >
                  <Calendar className="mr-1 h-3 w-3" /> Verlängern
                </Button>
              )}
              {isMutating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </TabsContent>

          <TabsContent value="devices" className="mt-4">
            {devLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <StandaloneLicenseDeviceTable
                devices={devices}
                onRemove={(dev) =>
                  removeDevice.mutate({
                    license_id: license.license_id,
                    device_fingerprint: dev.device_fingerprint,
                  })
                }
              />
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            {evtLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <StandaloneLicenseEventFeed events={events} />
            )}
          </TabsContent>
        </Tabs>
      </AdminSheetContent>
    </AdminSheet>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}
