import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/* ── Types ── */
export interface StandaloneLicense {
  id: string;
  license_id: string;
  email: string;
  course_id: string;
  course_title: string;
  package_id: string;
  package_title: string;
  status: string;
  device_limit: number;
  expires_at: string | null;
  last_validated_at: string | null;
  last_opened_at: string | null;
  issued_at: string;
  metadata: Record<string, unknown> | null;
  device_count: number;
  last_seen_at: string | null;
  risk_level: "ok" | "warning" | "critical";
}

export interface LicenseDevice {
  id: string;
  license_id: string;
  email: string;
  course_title: string;
  package_title: string;
  device_fingerprint: string;
  first_seen_at: string;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface LicenseEvent {
  id: string;
  license_id: string;
  email: string;
  course_title: string;
  package_title: string;
  event_type: string;
  event_status: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface LicenseRisk {
  license_id: string;
  email: string;
  course_title: string;
  package_title: string;
  status: string;
  device_limit: number;
  device_count: number;
  last_seen_at: string | null;
  risk_level: "ok" | "warning" | "critical";
}

/* ── Helper: call the single admin-read function ── */
async function adminRead<T>(view: string, extra?: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.functions.invoke(
    "admin-read-standalone-licenses",
    { body: { view, ...extra } },
  );
  if (error) throw new Error(error.message ?? "Admin-Read fehlgeschlagen");
  if (data?.error) throw new Error(data.error);
  return (data?.data ?? []) as T[];
}

/* ── Queries ── */

export function useStandaloneLicenses() {
  return useQuery({
    queryKey: ["standalone-licenses"],
    queryFn: () => adminRead<StandaloneLicense>("licenses"),
    refetchInterval: 30_000,
  });
}

export function useLicenseDevices(licenseId: string | null) {
  return useQuery({
    queryKey: ["standalone-license-devices", licenseId],
    queryFn: () => adminRead<LicenseDevice>("devices", { license_id: licenseId }),
    enabled: !!licenseId,
  });
}

export function useLicenseEvents(licenseId: string | null) {
  return useQuery({
    queryKey: ["standalone-license-events", licenseId],
    queryFn: () => adminRead<LicenseEvent>("events", { license_id: licenseId }),
    enabled: !!licenseId,
  });
}

export function useLicenseRiskBoard() {
  return useQuery({
    queryKey: ["standalone-license-risk"],
    queryFn: () => adminRead<LicenseRisk>("risk"),
    refetchInterval: 30_000,
  });
}

/* ── Shared invalidation keys ── */
const ALL_LICENSE_KEYS = [
  "standalone-licenses",
  "standalone-license-risk",
] as const;

/* ── Mutations ── */

export function useUpdateLicenseStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      license_id: string;
      next_status: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "admin-update-standalone-license-status",
        { body: params },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Lizenz ${vars.next_status}`);
      ALL_LICENSE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
      qc.invalidateQueries({ queryKey: ["standalone-license-devices", vars.license_id] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });
}

export function useRemoveDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      license_id: string;
      device_fingerprint: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "admin-remove-standalone-license-device",
        { body: params },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success("Gerät entfernt");
      ALL_LICENSE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["standalone-license-devices", vars.license_id] });
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });
}

export function useExtendLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      license_id: string;
      expires_at: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "admin-extend-standalone-license",
        { body: params },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success("Ablaufdatum verlängert");
      ALL_LICENSE_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
    },
    onError: (err: Error) => toast.error(`Fehler: ${err.message}`),
  });
}
