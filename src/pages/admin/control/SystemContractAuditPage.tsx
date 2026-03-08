import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function SystemContractAuditPage() {
  const [violations, setViolations] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [enums, setEnums] = useState<any[]>([]);
  const [log, setLog] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [v, c, m, e] = await Promise.all([
      supabase.from("system_contract_violations").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("system_contract_registry").select("*").order("contract_type"),
      supabase.from("system_ssot_mappings").select("*").order("mapping_type"),
      supabase.from("system_enum_registry").select("*").order("enum_scope"),
    ]);

    setViolations(v.data || []);
    setContracts(c.data || []);
    setMappings(m.data || []);
    setEnums(e.data || []);
  }

  async function run() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("system-assertion-cron", { body: {} });
    setLog(error ? { error } : data);
    setLoading(false);
    await load();
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">System Contract Audit</h1>
          <p className="text-sm text-muted-foreground">
            SSOT Cleanup, Contract Registry, Enum Registry und Pipeline Status Integrity
          </p>
        </div>
        <button className="px-4 py-2 rounded-md border bg-background hover:bg-accent" onClick={run} disabled={loading}>
          {loading ? "Prüfe..." : "Audit ausführen"}
        </button>
      </div>

      {log && (
        <pre className="rounded-xl border p-3 text-xs overflow-auto bg-muted/20">
          {JSON.stringify(log, null, 2)}
        </pre>
      )}

      <div>
        <h2 className="font-medium mb-2">Open Violations</h2>
        <div className="space-y-3">
          {violations.length === 0 && <p className="text-sm text-muted-foreground">Keine Violations.</p>}
          {violations.map((row: any) => (
            <div key={row.id} className="rounded-xl border p-4">
              <div className="font-medium">{row.violation_type}</div>
              <div className="text-xs text-muted-foreground">
                {row.severity} · {row.status}
              </div>
              <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(row.details, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-medium mb-2">Contracts ({contracts.length})</h2>
        <div className="space-y-2">
          {contracts.map((row: any) => (
            <div key={row.id} className="rounded-xl border p-3 text-sm">
              {row.contract_key} · {row.contract_type} · {row.owner_layer}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-medium mb-2">SSOT Mappings ({mappings.length})</h2>
        <div className="space-y-2">
          {mappings.map((row: any) => (
            <div key={row.id} className="rounded-xl border p-3 text-sm">
              {row.mapping_key}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-medium mb-2">Enums ({enums.length})</h2>
        <div className="space-y-2">
          {enums.map((row: any) => (
            <div key={row.id} className="rounded-xl border p-3 text-sm">
              {row.enum_key} — {JSON.stringify(row.allowed_values)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
