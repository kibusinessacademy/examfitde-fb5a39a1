import { supabase } from "@/integrations/supabase/client";

export type ManifestFile = {
  path: string;
  mime: string;
  size: number;
  kind: "text" | "binary" | "blocked";
  text?: string;
  base64?: string;
  blocked_reason?: string;
};

export type ExportManifest = {
  ok: true;
  package_id: string;
  export_path: string;
  file_count: number;
  total_bytes: number;
  files: ManifestFile[];
};

export async function fetchExportManifest(packageId: string): Promise<ExportManifest> {
  const { data, error } = await supabase.functions.invoke<ExportManifest>(
    "export-course-package-manifest",
    { body: { packageId } },
  );
  if (error) throw new Error(error.message ?? "manifest_failed");
  if (!data || !("ok" in data)) throw new Error("invalid_manifest_response");
  return data;
}

/** Build a tree from flat path list. */
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
  // sort: dirs first, then alpha
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

/** Build a filtered ZIP from accepted files via JSZip. */
export async function buildFilteredZip(
  manifest: ExportManifest,
  acceptedPaths: Set<string>,
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of manifest.files) {
    if (!acceptedPaths.has(f.path)) continue;
    if (f.kind === "blocked") continue;
    if (f.kind === "text" && typeof f.text === "string") {
      zip.file(f.path, f.text);
    } else if (f.kind === "binary" && typeof f.base64 === "string") {
      const bin = atob(f.base64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      zip.file(f.path, u8);
    }
  }
  return zip.generateAsync({ type: "blob" });
}

export async function emitExportFilteredAudit(
  packageId: string,
  acceptedPaths: string[],
  rejectedCount: number,
): Promise<void> {
  await supabase.rpc("fn_emit_audit" as never, {
    _action_type: "scaffold_export_filtered",
    _target_type: "course_package",
    _target_id: packageId,
    _result_status: "success",
    _payload: {
      package_id: packageId,
      accepted_count: acceptedPaths.length,
      rejected_count: rejectedCount,
      accepted_paths: acceptedPaths,
    },
    _trigger_source: "export-preview-ui",
  } as never);
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
