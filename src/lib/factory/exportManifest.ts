import { supabase } from "@/integrations/supabase/client";

export type ManifestFile = {
  path: string;
  mime: string;
  size: number;
  kind: "text" | "binary" | "oversized" | "blocked";
  text?: string;
  blocked_reason?: string;
};

export type ExportManifest = {
  ok: true;
  package_id: string;
  package_key: string | null;
  export_path: string;
  export_hash: string;
  cache_hit: boolean;
  file_count: number;
  total_bytes: number;
  inline_limit_bytes: number;
  files: ManifestFile[];
};

export async function fetchExportManifest(
  packageId: string,
  opts: { refresh?: boolean } = {},
): Promise<ExportManifest> {
  const { data, error } = await supabase.functions.invoke<ExportManifest>(
    "export-course-package-manifest",
    { body: { packageId, mode: "manifest", refresh: opts.refresh === true } },
  );
  if (error) throw new Error(error.message ?? "manifest_failed");
  if (!data || !("ok" in data)) throw new Error("invalid_manifest_response");
  return data;
}

/** Server-side filtered re-zip (P13.1): kein client-Bundling mehr für Binärdateien. */
export async function downloadFilteredZip(
  packageId: string,
  acceptedPaths: string[],
): Promise<{ blob: Blob; filename: string; exportHash: string | null }> {
  const session = (await supabase.auth.getSession()).data.session;
  const projectId = (import.meta as { env: Record<string, string> }).env
    .VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/export-course-package-manifest`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: session?.access_token ? `Bearer ${session.access_token}` : "",
      apikey: (import.meta as { env: Record<string, string> }).env
        .VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ packageId, mode: "rezip", acceptedPaths }),
  });
  if (!resp.ok) {
    let msg = `rezip failed (${resp.status})`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const cd = resp.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  const filename = m?.[1] ?? `export-${packageId}.zip`;
  const blob = await resp.blob();
  return { blob, filename, exportHash: resp.headers.get("x-export-hash") };
}

export type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
  file?: ManifestFile;
};

export function buildTree(files: ManifestFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", isFile: false, children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((p, i) => {
      const isLeaf = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === p);
      if (!next) {
        next = {
          name: p,
          path: parts.slice(0, i + 1).join("/"),
          isFile: isLeaf,
          children: [],
          file: isLeaf ? f : undefined,
        };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
