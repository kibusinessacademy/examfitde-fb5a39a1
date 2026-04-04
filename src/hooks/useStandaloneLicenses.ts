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
  expires_at: string;
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

/* ── Queries ── */

export function useStandaloneLicenses() {
  return useQuery({
    queryKey: ["standalone-licenses"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_admin_standalone_licenses")
        .select("*")
        .order("issued_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StandaloneLicense[];
    },
    refetchInterval: 30_000,
  });
}

export function useLicenseDevices(licenseId: string | null) {
  return useQuery({
    queryKey: ["standalone-license-devices", licenseId],
    queryFn: async () => {
      if (!licenseId) return [];
      const { data, error } = await (supabase as any)
        .from("v_admin_standalone_license_devices")
        .select("*")
        .eq("license_id", licenseId)
        .order("first_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LicenseDevice[];
    },
    enabled: !!licenseId,
  });
}

export function useLicenseEvents(licenseId: string | null) {
  return useQuery({
    queryKey: ["standalone-license-events", licenseId],
    queryFn: async () => {
      if (!licenseId) return [];
      const { data, error } = await (supabase as any)
        .from("v_admin_standalone_license_events")
        .select("*")
        .eq("license_id", licenseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LicenseEvent[];
    },
    enabled: !!licenseId,
  });
}

export function useLicenseRiskBoard() {
  return useQuery({
    queryKey: ["standalone-license-risk"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_admin_standalone_license_risk")
        .select("*")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LicenseRisk[];
    },
    refetchInterval: 30_000,
  });
}

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
      qc.invalidateQueries({ queryKey: ["standalone-licenses"] });
      qc.invalidateQueries({ queryKey: ["standalone-license-risk"] });
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
    },
    onError: (err: Error) => {
      toast.error(`Fehler: ${err.message}`);
    },
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
      qc.invalidateQueries({ queryKey: ["standalone-license-devices", vars.license_id] });
      qc.invalidateQueries({ queryKey: ["standalone-licenses"] });
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
    },
    onError: (err: Error) => {
      toast.error(`Fehler: ${err.message}`);
    },
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
      qc.invalidateQueries({ queryKey: ["standalone-licenses"] });
      qc.invalidateQueries({ queryKey: ["standalone-license-events", vars.license_id] });
    },
    onError: (err: Error) => {
      toast.error(`Fehler: ${err.message}`);
    },
  });
}
