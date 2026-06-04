/**
 * BerufsKI Premium PDF Template
 *
 * Renders structured ContentJson into print-ready HTML.
 * Design: A4, 20mm margins, professional typography, tier-specific covers.
 */

import type { ContentJson, ContentSection } from "./berufski-content-schema.ts";

export interface PdfTheme {
  primary: string;
  accent: string;
  font: string;
  logoUrl?: string | null;
  brandName: string;
}

export function premiumCss(theme: PdfTheme): string {
  return `
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  html, body { font-family: '${theme.font}', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #1a1a1a; font-size: 11.5px; line-height: 1.6; }
  h1, h2, h3 { color: ${theme.primary}; margin: 0 0 8px 0; page-break-after: avoid; }
  h1 { font-size: 26px; font-weight: 800; }
  h2 { font-size: 18px; font-weight: 700; margin-top: 24px; padding-bottom: 4px; border-bottom: 2px solid ${theme.accent}20; }
  h3 { font-size: 14px; font-weight: 600; margin-top: 16px; }
  p { margin: 6px 0; }
  ul, ol { padding-left: 20px; margin: 6px 0; }
  li { margin: 4px 0; }

  /* Cover */
  .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: space-between; min-height: 247mm; }
  .cover-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .cover-badge { display: inline-block; padding: 6px 14px; border-radius: 999px; background: ${theme.accent}; color: white; font-weight: 700; font-size: 13px; }
  .cover-title { margin-top: 30mm; }
  .cover-title .title { font-size: 36px; font-weight: 800; color: ${theme.primary}; line-height: 1.2; }
  .cover-title .subtitle { font-size: 17px; color: #333; margin-top: 10px; }
  .cover-meta { font-size: 12px; color: #555; margin-top: 12px; }
  .cover-brand { font-weight: 800; color: ${theme.primary}; font-size: 18px; }
  .cover-art { width: 80mm; height: 52mm; border-radius: 18px; background: linear-gradient(135deg, ${theme.primary}, ${theme.accent}); }

  /* TOC */
  .toc { page-break-after: always; }
  .toc ol { counter-reset: toc-counter; list-style: none; padding-left: 0; }
  .toc li { counter-increment: toc-counter; padding: 8px 0; border-bottom: 1px solid #eee; font-size: 13px; }
  .toc li::before { content: counter(toc-counter) ". "; font-weight: 700; color: ${theme.primary}; }
  .toc a { text-decoration: none; color: #1a1a1a; }

  /* Content blocks */
  .section { page-break-inside: avoid; margin-bottom: 16px; }
  .callout { border-left: 4px solid ${theme.accent}; padding: 10px 14px; background: ${theme.accent}08; margin: 12px 0; border-radius: 0 10px 10px 0; }
  .callout.warning { border-left-color: #f59f00; background: #fff8e6; }
  .callout.danger { border-left-color: #e03131; background: #fff0f0; }

  /* Prompt cards */
  .prompt-card { border: 1px solid #e0e0e0; border-radius: 10px; padding: 12px 16px; margin: 10px 0; page-break-inside: avoid; background: #fafbfc; }
  .prompt-card .prompt-name { font-weight: 700; color: ${theme.primary}; font-size: 13px; margin-bottom: 4px; }
  .prompt-card .prompt-when { font-size: 10.5px; color: #666; margin-bottom: 6px; }
  .prompt-card .prompt-text { background: #f0f4f8; padding: 8px 12px; border-radius: 6px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 10.5px; white-space: pre-wrap; line-height: 1.5; }
  .prompt-card .prompt-ref { font-size: 9px; color: #999; margin-top: 4px; }

  /* Case study */
  .case-card { border: 1px solid #d0e8d8; border-radius: 10px; padding: 14px 16px; margin: 12px 0; page-break-inside: avoid; background: #f8fcf9; }
  .case-card .case-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: ${theme.accent}; font-weight: 700; margin-bottom: 6px; }

  /* Workflow */
  .workflow-card { border: 1px solid #dde4f0; border-radius: 10px; padding: 14px 16px; margin: 12px 0; page-break-inside: avoid; background: #f6f8fc; }
  .workflow-steps { counter-reset: step-counter; list-style: none; padding-left: 0; }
  .workflow-steps li { counter-increment: step-counter; padding: 4px 0 4px 28px; position: relative; }
  .workflow-steps li::before { content: counter(step-counter); position: absolute; left: 0; width: 22px; height: 22px; border-radius: 50%; background: ${theme.primary}; color: white; text-align: center; line-height: 22px; font-size: 11px; font-weight: 700; }

  /* DSGVO */
  .dsgvo-rule { border-left: 3px solid #e03131; padding: 8px 12px; margin: 8px 0; background: #fff8f8; border-radius: 0 8px 8px 0; page-break-inside: avoid; }
  .dsgvo-rule .rule-title { font-weight: 700; color: #c92a2a; }
  .dsgvo-rule .rule-risk { font-size: 10px; color: #e03131; margin-top: 4px; }

  /* Table */
  .data-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10.8px; }
  .data-table th, .data-table td { border: 1px solid #e0e0e0; padding: 8px 10px; vertical-align: top; }
  .data-table th { background: ${theme.primary}08; text-align: left; font-weight: 700; color: ${theme.primary}; }

  /* Checklist */
  .checklist { list-style: none; padding-left: 0; }
  .checklist li { padding: 4px 0 4px 26px; position: relative; }
  .checklist li::before { content: "☐"; position: absolute; left: 0; font-size: 16px; color: ${theme.accent}; }

  /* Footer */
  .page-footer { position: fixed; bottom: 8mm; left: 20mm; right: 20mm; font-size: 9px; color: #888; display: flex; justify-content: space-between; border-top: 1px solid #eee; padding-top: 4px; }
  .stamp { color: #666; font-style: italic; }

  /* Utility */
  .hr { height: 1px; background: #e0e0e0; margin: 14px 0; }
  .muted { color: #666; }
  .small { font-size: 10px; }
  .avoid-break { page-break-inside: avoid; }
  `;
}

/**
 * Render a ContentSection to HTML
 */
function renderSection(section: ContentSection): string {
  switch (section.type) {
    case "intro":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          ${section.paragraphs.map(p => `<p>${esc(p)}</p>`).join("")}
        </div>`;

    case "timewasters":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          <ul>${section.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>
          ${section.quickWins.length ? `
            <div class="callout">
              <strong>Quick Wins:</strong>
              <ul>${section.quickWins.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
            </div>` : ""}
        </div>`;

    case "prompts":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          ${section.items.map(item => `
            <div class="prompt-card">
              <div class="prompt-name">${esc(item.name)}</div>
              <div class="prompt-when">${esc(item.whenToUse)}</div>
              <div class="prompt-text">${esc(item.prompt)}</div>
              ${item.lernfeldRef ? `<div class="prompt-ref">📚 ${esc(item.lernfeldRef)}</div>` : ""}
            </div>
          `).join("")}
        </div>`;

    case "workflows":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          ${section.flows.map(flow => `
            <div class="workflow-card">
              <h3>${esc(flow.name)}</h3>
              <p class="muted small">${esc(flow.goal)}</p>
              <ol class="workflow-steps">
                ${flow.steps.map(s => `<li>${esc(s)}</li>`).join("")}
              </ol>
              ${flow.output.length ? `<p class="small"><strong>Output:</strong> ${flow.output.map(esc).join(", ")}</p>` : ""}
            </div>
          `).join("")}
        </div>`;

    case "cases":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          ${section.cases.map((c, i) => `
            <div class="case-card">
              <div class="case-label">Praxisfall ${i + 1}${c.kompetenzRef ? ` · ${esc(c.kompetenzRef)}` : ""}</div>
              <p><strong>Situation:</strong> ${esc(c.situation)}</p>
              <p><strong>Input:</strong> ${esc(c.input)}</p>
              <div class="callout"><strong>KI-Output:</strong> ${esc(c.output)}</div>
              ${c.pitfalls.length ? `<div class="callout warning"><strong>Achtung:</strong> ${c.pitfalls.map(esc).join("; ")}</div>` : ""}
              ${c.zeitersparnisMin ? `<p class="small muted">⏱ Zeitersparnis: ca. ${c.zeitersparnisMin} Min.</p>` : ""}
            </div>
          `).join("")}
        </div>`;

    case "dsgvo":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          ${section.rules.map(r => `
            <div class="dsgvo-rule">
              <div class="rule-title">⚖️ ${esc(r.rule)}</div>
              <p>${esc(r.explanation)}</p>
              <div class="rule-risk">⚠️ Risiko: ${esc(r.risk)}</div>
            </div>
          `).join("")}
        </div>`;

    case "checklist":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          <ul class="checklist">
            ${section.items.map(item => `<li>${esc(item)}</li>`).join("")}
          </ul>
        </div>`;

    case "table":
      return `
        <div class="section" id="${section.id}">
          <h2>${esc(section.title)}</h2>
          <table class="data-table">
            <thead><tr>${section.headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>${section.rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
          </table>
        </div>`;

    default:
      return "";
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build complete print-ready HTML from ContentJson + theme
 */
export function buildPremiumHtml(params: {
  content: ContentJson;
  theme: PdfTheme;
  coverDataUrl?: string | null;
  licenseStamp?: string | null;
  examfitUrl?: string;
}): string {
  const { content, theme, coverDataUrl, licenseStamp, examfitUrl } = params;
  const css = premiumCss(theme);

  const logo = theme.logoUrl
    ? `<img src="${theme.logoUrl}" style="height:16mm;width:auto;" />`
    : `<div class="cover-brand">${esc(theme.brandName)}</div>`;

  const coverArt = coverDataUrl
    ? `<img src="${coverDataUrl}" style="width:80mm;height:auto;border-radius:18px;" />`
    : `<div class="cover-art"></div>`;

  const stamp = licenseStamp ? `<span class="stamp">${esc(licenseStamp)}</span>` : "";
  const backlink = examfitUrl || "https://berufos.com";

  const toc = content.toc
    .map(t => `<li><a href="#${t.id}">${esc(t.label)}</a></li>`)
    .join("");

  const sections = content.sections.map(renderSection).join("\n");

  const dateStr = new Date().toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(content.meta.productTitle)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="page-footer">
    <div>© ${new Date().getFullYear()} ${esc(theme.brandName)} ${stamp}</div>
    <div>${esc(content.meta.productTitle)}</div>
  </div>

  <section class="cover">
    <div class="cover-top">
      ${logo}
      <span class="cover-badge">${esc(content.meta.tier)}€ · ${esc(content.meta.tier === "29" ? "Komplettsystem" : content.meta.tier === "19" ? "Praxisleitfaden" : "Prompt Guide")}</span>
    </div>
    <div class="cover-title">
      <div class="title">${esc(content.meta.productTitle)}</div>
      <div class="subtitle">${esc(content.meta.valuePromise)}</div>
      <div class="cover-meta">Stand: ${dateStr}</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <div class="small muted">Print-Ready Export · ${esc(content.meta.berufName)}</div>
      ${coverArt}
    </div>
  </section>

  <section class="toc">
    <h1>Inhaltsverzeichnis</h1>
    <div class="hr"></div>
    <ol>${toc}</ol>
  </section>

  ${sections}

  <div class="section avoid-break" style="margin-top:24px;">
    <div class="callout">
      <strong>💡 Weiterführende Ressourcen</strong>
      <p>Prüfungsvorbereitung & Fachkompetenz: <a href="${esc(backlink)}" style="color:${theme.primary}">${esc(backlink)}</a></p>
    </div>
  </div>

</body>
</html>`;
}
