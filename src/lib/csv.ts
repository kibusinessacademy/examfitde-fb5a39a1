export function toCsv(rows: Record<string, unknown>[]) {
  const headerSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r ?? {})) headerSet.add(k);
  }
  const headers = [...headerSet];

  const esc = (v: any) => {
    const t = v === null || v === undefined ? "" : String(v);
    const needs = /[",\n;]/.test(t);
    const cleaned = t.replace(/"/g, '""');
    return needs ? `"${cleaned}"` : cleaned;
  };

  const lines = [
    headers.join(";"),
    ...rows.map((r) => headers.map((h) => esc(r?.[h])).join(";")),
  ];
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
