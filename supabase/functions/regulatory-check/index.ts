/**
 * regulatory-check: Automated annual/on-demand scan for IHK/HWK/BIBB regulatory changes.
 * 
 * Scrapes official sources for Neuordnungen and creates regulatory_updates entries.
 * Covers: Ausbildungsberufe, Fortbildungen (Fachwirt, Meister, etc.), Studium changes.
 * 
 * Actions:
 *   - scan_all: Full scan of all sources (IHK, HWK, BIBB, KMK)
 *   - scan_ihk: IHK Ausbildung + Fortbildung only
 *   - scan_hwk: HWK Meisterprüfungen only
 *   - scan_bibb: BIBB Neuordnungen only
 *   - status: Show last scan results
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- Source URLs ---
const SOURCES = {
  bibb_neuordnungen: "https://www.bibb.de/de/41.php",
  ihk_muenchen_2025: "https://www.ihk-muenchen.de/ausbildung-fortbildung/ausbilden/ausbildungsverhaeltnis/ausbildungsberufe/neuordnungen-2025/",
  ihk_nuernberg_2026: "https://www.ihk-nuernberg.de/ausbildung/ich-bilde-aus-ich-moechte-ausbilden/ich-moechte-ausbilden/neugeordnete-ausbildungsberufe-2025/2026",
  ihk_hannover: "https://www.ihk.de/hannover/hauptnavigation/ausbildung-und-weiterbildung/ausbildung/ausbildung-a-z/neuordnungen",
  zdh_meister: "https://www.zdh.de/ueber-uns/fachbereich-berufliche-bildung/hoehere-berufsbildung/meister-im-handwerk/modernisierte-meisterpruefungsverordnungen/",
  bibb_fortbildung: "https://www.bibb.de/de/40.php",
};

interface ScrapeResult {
  markdown?: string;
  metadata?: { title?: string; sourceURL?: string };
}

async function scrapeUrl(url: string): Promise<ScrapeResult | null> {
  if (!FIRECRAWL_API_KEY) {
    console.error("FIRECRAWL_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl error for ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.data || data;
  } catch (err) {
    console.error(`Scrape failed for ${url}:`, err);
    return null;
  }
}

// --- Detection Logic ---

interface DetectedChange {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  legal_reference: string | null;
  effective_date: string | null;
  affected_topics: string[];
  description: string;
  auto_action: string;
}

function extractYear(text: string): string | null {
  const m = text.match(/(?:ab\s+)?(?:01\.?\s*)?(?:August|Januar|Februar|März|April|Mai|Juni|Juli|September|Oktober|November|Dezember)\s+(\d{4})/i);
  if (m) return m[1];
  const m2 = text.match(/(\d{4})\s+in\s+Kraft/i);
  return m2 ? m2[1] : null;
}

function extractEffectiveDate(text: string): string | null {
  // Try "01. August 2026" format
  const monthMap: Record<string, string> = {
    januar: "01", februar: "02", "märz": "03", april: "04", mai: "05", juni: "06",
    juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
  };
  const m = text.match(/(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/i);
  if (m) {
    const month = monthMap[m[2].toLowerCase()];
    return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function detectNeuordnungenFromMarkdown(markdown: string, source: string): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const lines = markdown.split("\n");

  // Look for patterns like "Neuordnung", "neue Ausbildungsordnung", "modernisiert"
  const sections: string[] = [];
  let currentSection = "";

  for (const line of lines) {
    if (line.startsWith("#") || line.startsWith("##")) {
      if (currentSection.length > 50) sections.push(currentSection);
      currentSection = line + "\n";
    } else {
      currentSection += line + "\n";
    }
  }
  if (currentSection.length > 50) sections.push(currentSection);

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (
      lower.includes("neuordnung") ||
      lower.includes("neue ausbildungsordnung") ||
      lower.includes("modernisiert") ||
      lower.includes("tritt in kraft") ||
      lower.includes("neue verordnung")
    ) {
      // Extract profession name from heading
      const headingMatch = section.match(/^#+\s*(?:Neuordnung\s+(?:der\s+)?)?(.+)/m);
      const professionName = headingMatch ? headingMatch[1].trim().replace(/\s+/g, " ") : "Unbekannt";

      // Skip generic headings
      if (professionName.length < 5 || professionName.length > 200) continue;
      if (["Neuordnungen", "Übersicht", "Aktuelles", "Newsletter"].includes(professionName)) continue;

      const effectiveDate = extractEffectiveDate(section);
      const year = extractYear(section) || new Date().getFullYear().toString();

      const isCritical = lower.includes("19 berufe") || lower.includes("bauberufe");
      const isNewProfession = lower.includes("ersetzt") || lower.includes("neuer beruf") || lower.includes("abgelöst");

      changes.push({
        title: `Neuordnung ${professionName} – AO ${year}`,
        severity: isCritical ? "critical" : isNewProfession ? "high" : "medium",
        source,
        legal_reference: section.match(/(?:BGBl\.\s*\d{4}\/\d+|Verordnung vom \d{1,2}\.\s*\w+\s*\d{4})/i)?.[0] || null,
        effective_date: effectiveDate || `${year}-08-01`,
        affected_topics: [professionName.replace(/^Neuordnung\s+(?:der\s+)?/i, "").trim()],
        description: section.slice(0, 500).trim(),
        auto_action: isCritical || isNewProfession ? "rebuild_checks" : "mark_review",
      });
    }
  }

  return changes;
}

function detectMeisterChanges(markdown: string): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const sections = markdown.split(/(?=##?\s)/);

  for (const section of sections) {
    const lower = section.toLowerCase();
    if (
      lower.includes("meisterprüfungsverordnung") ||
      lower.includes("modernisierte meister")
    ) {
      const headingMatch = section.match(/^#+\s*(.+)/m);
      const title = headingMatch ? headingMatch[1].trim() : "Meisterprüfung";
      const effectiveDate = extractEffectiveDate(section);

      changes.push({
        title: `Modernisierte ${title}`,
        severity: "medium",
        source: "HWK/ZDH",
        legal_reference: section.match(/Meisterprüfungsverordnung\s+\w+/i)?.[0] || null,
        effective_date: effectiveDate,
        affected_topics: [title],
        description: section.slice(0, 500).trim(),
        auto_action: "mark_review",
      });
    }
  }

  return changes;
}

// --- Deduplication ---
async function filterExistingUpdates(changes: DetectedChange[]): Promise<DetectedChange[]> {
  if (changes.length === 0) return [];

  const { data: existing } = await supabase
    .from("regulatory_updates")
    .select("title, effective_date")
    .order("created_at", { ascending: false })
    .limit(500);

  if (!existing) return changes;

  const existingSet = new Set(
    existing.map((e: any) => `${e.title?.toLowerCase()}|${e.effective_date}`)
  );

  return changes.filter((c) => {
    const key = `${c.title.toLowerCase()}|${c.effective_date}`;
    return !existingSet.has(key);
  });
}

// --- Match affected curricula ---
async function matchAffectedCurricula(topics: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const topic of topics) {
    const searchTerm = topic.replace(/-/g, " ").replace(/\s+/g, " ").trim();
    const { data } = await supabase
      .from("curricula")
      .select("id")
      .or(`title.ilike.%${searchTerm}%`)
      .limit(10);

    if (data) {
      ids.push(...data.map((d: any) => d.id));
    }
  }
  return [...new Set(ids)];
}

// --- Insert new updates ---
async function insertUpdates(changes: DetectedChange[]): Promise<number> {
  let inserted = 0;
  for (const change of changes) {
    const affectedIds = await matchAffectedCurricula(change.affected_topics);

    const { error } = await supabase.from("regulatory_updates").insert({
      title: change.title,
      severity: change.severity,
      source: change.source,
      legal_reference: change.legal_reference,
      effective_date: change.effective_date,
      affected_topics: change.affected_topics,
      affected_curriculum_ids: affectedIds,
      auto_action: change.auto_action,
      description: change.description,
      impact_analysis: {
        affected_packages: affectedIds.length,
        auto_matched: true,
        scan_date: new Date().toISOString(),
      },
      processed: false,
    });

    if (!error) inserted++;
    else console.error("Insert error:", error.message);
  }
  return inserted;
}

// --- Scan orchestration ---
async function scanSource(name: string, url: string, parser: "neuordnung" | "meister"): Promise<DetectedChange[]> {
  console.log(`Scanning ${name}: ${url}`);
  const result = await scrapeUrl(url);
  if (!result?.markdown) {
    console.warn(`No content from ${name}`);
    return [];
  }

  const changes = parser === "meister"
    ? detectMeisterChanges(result.markdown)
    : detectNeuordnungenFromMarkdown(result.markdown, name);

  console.log(`${name}: ${changes.length} potential changes detected`);
  return changes;
}

async function scanAll(): Promise<{ total: number; new: number; sources: Record<string, number> }> {
  const allChanges: DetectedChange[] = [];
  const sourceCounts: Record<string, number> = {};

  // Parallel scrape all sources
  const [bibb, ihkM, ihkN, ihkH, zdh] = await Promise.all([
    scanSource("BIBB", SOURCES.bibb_neuordnungen, "neuordnung"),
    scanSource("IHK München", SOURCES.ihk_muenchen_2025, "neuordnung"),
    scanSource("IHK Nürnberg", SOURCES.ihk_nuernberg_2026, "neuordnung"),
    scanSource("IHK Hannover", SOURCES.ihk_hannover, "neuordnung"),
    scanSource("ZDH/HWK", SOURCES.zdh_meister, "meister"),
  ]);

  const sources = { bibb, ihkM, ihkN, ihkH, zdh };
  for (const [name, changes] of Object.entries(sources)) {
    allChanges.push(...changes);
    sourceCounts[name] = changes.length;
  }

  // Deduplicate against existing
  const newChanges = await filterExistingUpdates(allChanges);
  const inserted = await insertUpdates(newChanges);

  return {
    total: allChanges.length,
    new: inserted,
    sources: sourceCounts,
  };
}

async function getStatus() {
  const { data: updates, count } = await supabase
    .from("regulatory_updates")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: unprocessed } = await supabase
    .from("regulatory_updates")
    .select("id", { count: "exact" })
    .eq("processed", false);

  return {
    total_updates: count || 0,
    unprocessed: unprocessed?.length || 0,
    recent: updates?.map((u: any) => ({
      title: u.title,
      severity: u.severity,
      source: u.source,
      effective_date: u.effective_date,
      processed: u.processed,
      created_at: u.created_at,
    })),
  };
}

// --- Main handler ---
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "status" } = await req.json().catch(() => ({}));

    let result: any;

    switch (action) {
      case "scan_all":
        result = await scanAll();
        break;

      case "scan_bibb":
        const bibbChanges = await scanSource("BIBB", SOURCES.bibb_neuordnungen, "neuordnung");
        const newBibb = await filterExistingUpdates(bibbChanges);
        result = { detected: bibbChanges.length, new: await insertUpdates(newBibb) };
        break;

      case "scan_ihk":
        const ihkAll: DetectedChange[] = [];
        const [m, n, h] = await Promise.all([
          scanSource("IHK München", SOURCES.ihk_muenchen_2025, "neuordnung"),
          scanSource("IHK Nürnberg", SOURCES.ihk_nuernberg_2026, "neuordnung"),
          scanSource("IHK Hannover", SOURCES.ihk_hannover, "neuordnung"),
        ]);
        ihkAll.push(...m, ...n, ...h);
        const newIhk = await filterExistingUpdates(ihkAll);
        result = { detected: ihkAll.length, new: await insertUpdates(newIhk) };
        break;

      case "scan_hwk":
        const hwkChanges = await scanSource("ZDH/HWK", SOURCES.zdh_meister, "meister");
        const newHwk = await filterExistingUpdates(hwkChanges);
        result = { detected: hwkChanges.length, new: await insertUpdates(newHwk) };
        break;

      case "status":
        result = await getStatus();
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}. Use scan_all, scan_ihk, scan_hwk, scan_bibb, or status.` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, action, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("regulatory-check error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
