import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Hidden floating debug panel for `useProductAccessByCurriculum`.
 *
 * Activate at runtime in the browser console:
 *   localStorage.setItem('debug:access','1'); location.reload();
 *
 * Disables itself in production builds unless explicitly enabled.
 * Reads all React-Query cache entries with key prefix `product-access-curriculum`
 * and renders enabled/queryKey/state/data + a Refetch button.
 */
export function AccessDebugPanel() {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnabled(window.localStorage?.getItem("debug:access") === "1");
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const unsub = queryClient.getQueryCache().subscribe(() => force((n) => n + 1));
    const interval = window.setInterval(() => force((n) => n + 1), 1000);
    return () => {
      unsub();
      window.clearInterval(interval);
    };
  }, [enabled, queryClient]);

  if (!enabled) return null;

  const entries = queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => Array.isArray(q.queryKey) && q.queryKey[0] === "product-access-curriculum");

  return (
    <div
      role="complementary"
      aria-label="Access debug panel"
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 99999,
        maxWidth: 380,
        maxHeight: "60vh",
        overflow: "auto",
        background: "rgba(15,23,42,0.95)",
        color: "#e2e8f0",
        font: "11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
        padding: 10,
        border: "1px solid #334155",
        borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>useProductAccessByCurriculum</strong>
        <button
          type="button"
          onClick={() => {
            window.localStorage.removeItem("debug:access");
            setEnabled(false);
          }}
          style={{ background: "transparent", color: "#94a3b8", border: "none", cursor: "pointer" }}
          aria-label="close debug panel"
        >
          ✕
        </button>
      </div>
      {entries.length === 0 && <div style={{ opacity: 0.7 }}>no queries cached yet</div>}
      {entries.map((q) => {
        const [, userId, curriculumId, feature] = q.queryKey as [string, string, string, string];
        const s = q.state;
        return (
          <div
            key={q.queryHash}
            style={{ borderTop: "1px dashed #334155", paddingTop: 6, marginTop: 6 }}
          >
            <div>user: <code>{String(userId)}</code></div>
            <div>curriculum: <code>{String(curriculumId)}</code></div>
            <div>feature: <code>{String(feature)}</code></div>
            <div>
              status: <code>{s.status}</code> · fetch: <code>{s.fetchStatus}</code> · enabled:{" "}
              <code>{String(q.isActive())}</code>
            </div>
            <div>
              data: <code>{JSON.stringify(s.data)}</code>
            </div>
            <div style={{ opacity: 0.7 }}>updated: {new Date(s.dataUpdatedAt).toLocaleTimeString()}</div>
            <button
              type="button"
              onClick={() => queryClient.refetchQueries({ queryKey: q.queryKey })}
              style={{
                marginTop: 4,
                background: "#1e293b",
                color: "#e2e8f0",
                border: "1px solid #475569",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
              }}
            >
              Refetch
            </button>
          </div>
        );
      })}
    </div>
  );
}
