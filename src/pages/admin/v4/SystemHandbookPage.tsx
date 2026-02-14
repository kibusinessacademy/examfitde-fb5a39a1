import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BookOpen, Download, FileText, FileCode, Printer,
  ChevronDown, ChevronRight, Settings, Workflow, Shield,
  Brain, Activity, Layers, Factory, Zap, Clock, Target,
  AlertTriangle, CheckCircle2, ArrowRight, Database,
  Users, TrendingUp, Lock, Eye
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PageExplainer from '@/components/admin/PageExplainer';

/* ── Section data ── */

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  content: SectionBlock[];
}

interface SectionBlock {
  heading?: string;
  text?: string;
  list?: string[];
  table?: { headers: string[]; rows: string[][] };
  code?: string;
  note?: string;
}

const HANDBOOK_SECTIONS: Section[] = [
  {
    id: 'overview',
    title: 'Systemübersicht',
    icon: Eye,
    content: [
      {
        heading: 'ExamFit – Architektur auf einen Blick',
        text: 'ExamFit ist eine KI-gestützte Prüfungsvorbereitungsplattform für IHK/HWK-Zertifizierungen. Das System nutzt eine Dual-Track-Architektur (AUSBILDUNG_VOLL und EXAM_FIRST), eine autonome Produktions-Pipeline ("Product Factory") und ein Council-basiertes Governance-Modell (ECOS).',
      },
      {
        heading: 'Technologie-Stack',
        table: {
          headers: ['Schicht', 'Technologie'],
          rows: [
            ['Frontend', 'React 18 + Vite + Tailwind CSS + TypeScript'],
            ['Backend', 'Lovable Cloud (Supabase Edge Functions, Deno)'],
            ['Datenbank', 'PostgreSQL mit RLS-Policies'],
            ['KI-Provider', 'GPT-5.2 (Generator) + Claude Opus (Validator) + DeepSeek (Producer)'],
            ['Orchestrierung', 'pg_cron + job_queue + pipeline-runner'],
            ['Echtzeit', 'Supabase Realtime (Postgres Changes)'],
          ],
        },
      },
      {
        heading: 'Dual-Track-Produktausrichtung',
        text: 'Das System unterstützt zwei Produkt-Tracks über ein einheitliches Certification-Schema:',
        list: [
          'AUSBILDUNG_VOLL: Vollprodukt mit didaktischem 5-Schritte-Pfad, Lernkurs, Mini-Checks, AI-Tutor, Handbuch. Ship-Target: 850 Fragen.',
          'EXAM_FIRST: Fokus auf Prüfungssimulation mit 1000–1200+ Fragen, ohne Lernkurs/Lektionen. Ideal für Fortbildungen und Sachkunde-Prüfungen.',
        ],
      },
      {
        heading: 'Feature-Flag-Steuerung',
        text: 'Jeder Track definiert über die Tabelle `certifications` automatisch Feature-Flags, die bestimmen, welche Module aktiviert sind:',
        table: {
          headers: ['Flag', 'AUSBILDUNG_VOLL', 'EXAM_FIRST'],
          rows: [
            ['has_learning_course', '✅', '❌'],
            ['has_practice_course_h5p', '✅', '❌'],
            ['has_minichecks', '✅', '❌'],
            ['has_exam_trainer', '✅', '✅'],
            ['has_exam_simulation', '✅', '✅'],
            ['has_oral_exam_trainer', '✅', '❌'],
            ['has_ai_tutor', '✅ (full)', '✅ (limited_exam)'],
            ['has_handbook', '✅', '❌'],
          ],
        },
      },
    ],
  },
  {
    id: 'pipeline',
    title: 'Produktions-Pipeline',
    icon: Factory,
    content: [
      {
        heading: 'Gold-Standard Pipeline-Architektur',
        text: 'Die Pipeline nutzt eine Step-State-Machine (package_steps) und zeitbasierte Leases (package_leases) für kontrollierte Parallelität von bis zu 3 gleichzeitigen Paketen.',
      },
      {
        heading: '8-Schritte-Sequenz',
        table: {
          headers: ['#', 'Step', 'Beschreibung', 'Voraussetzung'],
          rows: [
            ['1', 'scaffold_learning_course', 'Erstellt Kursstruktur mit Modulen und Lektionen', 'Curriculum frozen'],
            ['2', 'auto_seed_exam_blueprints', 'Extrahiert Blueprint-Strukturen aus Kompetenzen', 'Step 1 done'],
            ['3', 'generate_exam_pool', 'Generiert Prüfungsfragen (Batching für große Curricula)', 'Step 2 done'],
            ['4', 'generate_oral_exam', 'Erstellt mündliche Prüfungsfragen', 'Step 2 done'],
            ['5', 'build_ai_tutor_index', 'Baut den AI-Tutor Kontext-Index', 'Step 1 done'],
            ['6', 'generate_handbook', 'Generiert das Prüfungshandbuch', 'Step 1 done'],
            ['7', 'run_integrity_check', 'Qualitätsprüfung aller Artefakte (Sync-Gate)', 'Steps 3–6 done'],
            ['8', 'auto_publish', 'Automatische Veröffentlichung bei bestandenem Check', 'Step 7 passed'],
          ],
        },
      },
      {
        heading: 'Parallelisierung',
        text: 'Die Steps 3–6 laufen intern parallel, um die Durchlaufzeit um Faktor 3–4 zu reduzieren. Step 7 (integrity_check) dient als Synchronisations-Gate und wartet via 409-Retry-Logik, bis alle Prerequisite-Steps den Status "done" haben.',
      },
      {
        heading: 'Batch-Processing für große Curricula',
        text: 'Langlaufende KI-Steps (z. B. generate_exam_pool) nutzen ein Batching-Protokoll: Wenn ein Worker "batch_complete: false" zurückgibt, speichert der Runner den batch_cursor im meta-Feld und setzt den Step auf "queued". So werden große Curricula über mehrere Runner-Zyklen abgearbeitet. max_attempts wird auf bis zu 50 erhöht.',
      },
      {
        heading: 'Lease-Management',
        text: 'Jedes aktive Paket erhält eine zeitlich begrenzte Lease (package_leases). Der Runner sendet alle 30 Sekunden Heartbeats. Bei abgelaufenen Leases setzt der pipeline-watchdog das Paket auf "queued" (nicht "failed"), damit es im nächsten Zyklus erneut aufgegriffen wird.',
      },
      {
        heading: 'Betriebsmodi',
        list: [
          'Factory Mode (Mass Build): QA-Checks sind non-blocking; Warnungen werden geloggt, aber das Paket bleibt buildable.',
          'Production Mode (Release Gate): Strikte QA; Ziel-Score ist Pflicht für Veröffentlichung.',
        ],
      },
    ],
  },
  {
    id: 'orchestration',
    title: 'Orchestrierung & Jobs',
    icon: Workflow,
    content: [
      {
        heading: 'Job-Runner Architektur',
        text: 'Der job-runner unterscheidet zwischen Factory-Jobs (setup_course_package, generate_curriculum_content) und Pipeline-Jobs (Build-Steps). Factory-Jobs sind WIP-befreit und dürfen jederzeit laufen.',
      },
      {
        heading: 'Concurrency Governance',
        table: {
          headers: ['Komponente', 'Funktion'],
          rows: [
            ['jobtype_limits', 'Max. Parallelität pro Job-Typ (z. B. max 2 für exam_pool)'],
            ['ai_worker_policies', 'max_attempts, timeout_seconds, max_cost_eur_per_day pro Typ'],
            ['Production Guardian', 'Dynamische Anpassung bei 429-Fehlern, Timeouts, Budget-Engpässen'],
            ['backpressure_snapshots', 'Echtzeit-Monitoring: pending_count, throughput, ETA'],
          ],
        },
      },
      {
        heading: 'Zero-Touch Orchestrierung',
        text: 'Der factory-orchestrator nutzt "Per-Package Isolation": Voraussetzungen (z. B. Curriculum frozen) werden individuell pro Paket geprüft. Ist ein Curriculum nicht bereit, wird nur dieses Paket blockiert (blocked_reason), alle anderen laufen weiter.',
      },
      {
        heading: 'Cron-Trigger',
        text: 'Die Pipeline wird minütlich über eine gesicherte cron-trigger Proxy-Funktion gestartet. Der Runner claimt Pakete atomar via FOR UPDATE SKIP LOCKED.',
      },
      {
        heading: 'Watchdog & Self-Healing',
        list: [
          'pipeline-watchdog: Erkennt stale Steps (kein Heartbeat), abgelaufene Leases und verwaiste Pakete.',
          'Alle drei Fälle → Status wird auf "queued" gesetzt (nicht "failed").',
          'production-guardian: Passt max_wip und jobtype_limits dynamisch an.',
          'ops-auto-healer: Automatische Korrekturmaßnahmen bei wiederholten Fehlern.',
        ],
      },
    ],
  },
  {
    id: 'quality',
    title: 'Qualitätssicherung',
    icon: Shield,
    content: [
      {
        heading: 'Quality Shield v3',
        text: 'Beide Tracks unterliegen einheitlichen Qualitäts-Gates. Der Integrity-Check (Step 7) validiert alle generierten Artefakte und errechnet einen Gesamtscore.',
      },
      {
        heading: 'Council-System (ECOS)',
        text: 'Das ExamFit Council Operating System gliedert das Unternehmen in 12 KI-Räte. Jedes Council nutzt eine Generator-Validator-Producer Rollenverteilung:',
        table: {
          headers: ['Rolle', 'Modell', 'Aufgabe'],
          rows: [
            ['Generator', 'GPT-5.2', 'Erstellt Inhalte und Vorschläge'],
            ['Validator', 'Claude Opus', 'Prüft, bewertet, gibt Feedback'],
            ['Producer', 'DeepSeek', 'Setzt Beschlüsse um, formatiert Output'],
          ],
        },
      },
      {
        heading: 'Blueprint-Template-System',
        text: 'Universelle Inhaltsquelle für alle Fragetypen. 9-stufige Enterprise-Architektur (Core → Didactic Frame → Variable Slots → Constraint Engine → Variation Rules → Answer Model → Validation Layer → Generation Protocol → Audit & Versioning). KI fungiert nur als Rendering-Layer.',
      },
      {
        heading: 'Prüfungssimulation',
        text: 'IHK-konforme Logik basierend auf gefrorenen Blueprints. Deterministische Algorithmen (Seeds) und Snapshots (exam_session_questions) garantieren Reproduzierbarkeit, Manipulationssicherheit und Auditfähigkeit.',
      },
    ],
  },
  {
    id: 'scaling',
    title: 'Skalierung (300 Berufe)',
    icon: Layers,
    content: [
      {
        heading: 'Batch-Seeding Pipeline',
        text: 'Zur Skalierung auf 300+ Berufe nutzt das System eine automatisierte Batch-Seeding-Pipeline: Berufe werden von "draft" → "frozen" überführt, dabei Lernfelder und Kompetenzen generiert, anschließend Kurspakete und Pläne angelegt.',
      },
      {
        heading: 'Dual-Provider-Strategie',
        text: 'GPT-5.2 und Claude Opus werden parallel eingesetzt, um Rate-Limit-Engpässe zu umgehen und die Produktionsgeschwindigkeit zu verdoppeln.',
      },
      {
        heading: 'Adaptive Auto-Scaling',
        text: 'Der Production Guardian wertet kontinuierlich 429-Fehler, Timeouts, CPU-Last und Budgetverbrauch aus und passt max_wip sowie jobtype_limits dynamisch an.',
      },
      {
        heading: 'Product Factory Spec',
        text: 'Die Tabelle product_factory_specs dient als SSOT für die Konfiguration jeder Zertifizierung (welche Artefakte mit welchen Parametern erzeugt werden). Ermöglicht Zero-Touch-Orchestrierung.',
      },
    ],
  },
  {
    id: 'admin-ui',
    title: 'Admin-Oberfläche (V4)',
    icon: Settings,
    content: [
      {
        heading: 'Modulares Layout',
        text: 'Die Admin-V4-Zentrale nutzt ein modulares Layout mit persistenter Global Status Bar (Health, Leases, Queue, Kosten) und funktionalen Echtzeit-Dashboards.',
      },
      {
        heading: 'Admin-Module',
        table: {
          headers: ['Modul', 'Pfad', 'Funktion'],
          rows: [
            ['Leitstelle', '/admin/command', 'Produktionssteuerung, KPI-Übersicht, Quick Actions'],
            ['Factory', '/admin/studio', 'Paket-Verwaltung, Neues Paket erstellen, Build-Monitoring'],
            ['Qualität', '/admin/quality', 'Review Inbox, Integrität, Compliance, AZAV/ISO'],
            ['Ops', '/admin/ops', 'Ampel & Alerts, Queue, Pipeline Live, Load Control, AI Workers'],
            ['Content & SEO', '/admin/content', 'Seiten, Blog, Assets, SEO & Redirects'],
            ['CRM', '/admin/crm', 'Kontakte, Segmente, Churn Risk'],
            ['Support', '/admin/support', 'Tickets, FAQ-Knüpfung'],
            ['Finanzen', '/admin/business', 'Umsatz, Lizenzen, Steuer-Export'],
            ['Wachstum', '/admin/growth', 'Nudge Engine, Feedback'],
            ['Skalierung', '/admin/scale', 'Berufe-Status, Reporting'],
          ],
        },
      },
      {
        heading: 'Gold-Pattern (Echtzeit)',
        text: 'Postgres-Realtime-Events triggern im Frontend automatisiertes Re-Fetching aggregierter Daten via RPCs. Keine inkonsistenten Shadow-States.',
      },
    ],
  },
  {
    id: 'ai-tutor',
    title: 'AI-Tutor & Oral Exam',
    icon: Brain,
    content: [
      {
        heading: 'AI-Tutor Modi',
        list: [
          'full: Vollständiger Tutor mit Kurskontext, Erklärungen, Übungen (AUSBILDUNG_VOLL)',
          'limited_exam: Fokus auf Prüfungsfragen und Lösungsstrategien (EXAM_FIRST)',
          'off: Deaktiviert',
        ],
      },
      {
        heading: 'Kontext-Index',
        text: 'Der AI-Tutor nutzt einen paket-spezifischen Kontext-Index (ai_tutor_context_index), der in Step 5 der Pipeline aufgebaut wird. Policies (ai_tutor_policies) steuern Antwortverhalten pro Curriculum.',
      },
      {
        heading: 'Oral-Exam-Trainer',
        text: 'Workflow: Fragen-Generierung aus Blueprints → TTS-Ausgabe → Listening (STT) → Evaluation nach IHK-Kriterien (Fachlichkeit, Struktur, Praxisbezug) → Musterantworten + Prüfer-Nachfragen.',
        note: 'Alle Fragen müssen aus question_blueprints abgeleitet werden. Freie KI-Generierung ohne Blueprint ist untersagt und wird auditiert.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Sicherheit & Compliance',
    icon: Lock,
    content: [
      {
        heading: 'Row-Level Security (RLS)',
        text: 'Alle Tabellen sind mit RLS-Policies geschützt. Lernerdaten sind über auth.uid() isoliert. Admin-Zugriff über eine separate is_admin-Prüfung.',
      },
      {
        heading: 'AZAV-Compliance',
        text: 'Das System unterstützt AZAV-Zulassungen (§178 SGB III) mit Fachbereich-Verwaltung, Maßnahmen-Zulassungen, Compliance-Checks und Audit-Log.',
      },
      {
        heading: 'Audit Trail',
        list: [
          'ai_generations: Vollständiges Log aller KI-Generierungen mit Kosten, Tokens, Modell.',
          'ai_validations: Bewertungen mit Dimensionsscores und Entscheidungen.',
          'admin_actions: Manuelle Admin-Aktionen mit Payload.',
          'auto_heal_log: Autonome Korrekturmaßnahmen.',
        ],
      },
    ],
  },
  {
    id: 'faq',
    title: 'Admin FAQ',
    icon: AlertTriangle,
    content: [
      {
        heading: 'Wie starte ich ein neues Paket?',
        text: 'Navigiere zu Factory → Neues Paket. Wähle eine Zertifizierung, den Track (Vollprodukt oder Exam-First) und starte den Build. Der Rest läuft autonom.',
      },
      {
        heading: 'Was tun bei "Stuck" Paketen?',
        text: 'In der Leitstelle werden Stuck-Pakete automatisch erkannt. Klicke "Retry" um die betroffenen Jobs zurückzusetzen. Der Watchdog setzt Pakete mit abgelaufenen Leases automatisch auf "queued".',
      },
      {
        heading: 'Wie funktioniert das Budget-Management?',
        text: 'Die Tabelle ai_cost_budgets definiert monatliche KI-Budgets. Der Production Guardian pausiert Jobs automatisch bei Überschreitung. Tageskosten sind unter Leitstelle → KPIs sichtbar.',
      },
      {
        heading: 'Wie ändere ich die maximale Parallelität?',
        text: 'Unter Ops → Load Control können jobtype_limits und max_wip angepasst werden. Der Production Guardian passt diese Werte auch automatisch bei Engpässen an.',
      },
      {
        heading: 'Was bedeuten die Pipeline-Modi?',
        text: 'Factory Mode = Schnelles Bauen, QA non-blocking. Production Mode = Strikte QA, Score-Pflicht für Release. Der Modus wird pro Paket über pipeline_mode gesteuert.',
      },
      {
        heading: 'Wie exportiere ich Kursinhalte?',
        text: 'Im Course Workspace gibt es dedizierte Export-Tabs für ZIP (vollständiges Paket) und JSX (Review-Format). Exporte werden über Edge Functions generiert.',
      },
      {
        heading: 'Was passiert bei einem 429-Fehler?',
        text: 'Rate-Limit-Fehler (429) werden automatisch behandelt: Der Job wird mit exponentiellem Backoff erneut versucht. Bei gehäuften 429ern drosselt der Production Guardian die Parallelität.',
      },
      {
        heading: 'Wie skaliere ich auf neue Berufe?',
        text: 'Unter Skalierung → Berufe-Status können neue Berufe via Batch-Seeding angelegt werden. Die Pipeline generiert automatisch Curricula, Blueprints und Kurspakete.',
      },
    ],
  },
];

/* ── Export helpers ── */

function generatePlainText(sections: Section[]): string {
  let out = '═══════════════════════════════════════════\n';
  out += '  ExamFit System-Handbuch\n';
  out += '  Exportiert: ' + new Date().toLocaleString('de-DE') + '\n';
  out += '═══════════════════════════════════════════\n\n';

  for (const s of sections) {
    out += `\n${'━'.repeat(50)}\n`;
    out += `  ${s.title.toUpperCase()}\n`;
    out += `${'━'.repeat(50)}\n\n`;
    for (const b of s.content) {
      if (b.heading) out += `## ${b.heading}\n\n`;
      if (b.text) out += `${b.text}\n\n`;
      if (b.list) {
        for (const li of b.list) out += `  • ${li}\n`;
        out += '\n';
      }
      if (b.table) {
        const widths = b.table.headers.map((h, i) =>
          Math.max(h.length, ...b.table!.rows.map(r => (r[i] || '').length))
        );
        out += b.table.headers.map((h, i) => h.padEnd(widths[i])).join(' │ ') + '\n';
        out += widths.map(w => '─'.repeat(w)).join('─┼─') + '\n';
        for (const row of b.table.rows) {
          out += row.map((c, i) => c.padEnd(widths[i])).join(' │ ') + '\n';
        }
        out += '\n';
      }
      if (b.code) out += `\`\`\`\n${b.code}\n\`\`\`\n\n`;
      if (b.note) out += `⚠️ Hinweis: ${b.note}\n\n`;
    }
  }
  return out;
}

function generateHTML(sections: Section[]): string {
  let html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>ExamFit System-Handbuch</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:40px 20px;color:#1a1a2e;line-height:1.6}
h1{font-size:28px;border-bottom:3px solid #4361ee;padding-bottom:8px}
h2{font-size:20px;color:#4361ee;margin-top:32px;border-bottom:1px solid #e0e0e0;padding-bottom:4px}
h3{font-size:16px;margin-top:20px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:13px}
th{background:#f5f5f5;font-weight:600}
ul{padding-left:20px}
li{margin:4px 0;font-size:14px}
p{font-size:14px}
.note{background:#fff3cd;border-left:4px solid #ffc107;padding:8px 12px;margin:8px 0;font-size:13px}
.meta{color:#666;font-size:12px;margin-bottom:24px}
code{background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:13px}
@media print{body{padding:20px}h2{break-before:auto}}
</style></head><body>
<h1>ExamFit System-Handbuch</h1>
<p class="meta">Exportiert: ${new Date().toLocaleString('de-DE')}</p>`;

  for (const s of sections) {
    html += `<h2>${s.title}</h2>`;
    for (const b of s.content) {
      if (b.heading) html += `<h3>${b.heading}</h3>`;
      if (b.text) html += `<p>${b.text}</p>`;
      if (b.list) {
        html += '<ul>';
        for (const li of b.list) html += `<li>${li}</li>`;
        html += '</ul>';
      }
      if (b.table) {
        html += '<table><thead><tr>';
        for (const h of b.table.headers) html += `<th>${h}</th>`;
        html += '</tr></thead><tbody>';
        for (const row of b.table.rows) {
          html += '<tr>';
          for (const c of row) html += `<td>${c}</td>`;
          html += '</tr>';
        }
        html += '</tbody></table>';
      }
      if (b.note) html += `<div class="note">⚠️ ${b.note}</div>`;
    }
  }
  html += '</body></html>';
  return html;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Component ── */

export default function SystemHandbookPage() {
  const [activeSection, setActiveSection] = useState('overview');
  const printRef = useRef<HTMLDivElement>(null);

  const exportJSX = () => {
    const text = generatePlainText(HANDBOOK_SECTIONS);
    downloadBlob(text, 'examfit-system-handbuch.txt', 'text/plain;charset=utf-8');
  };

  const exportDOCX = () => {
    const html = generateHTML(HANDBOOK_SECTIONS);
    // DOCX via HTML blob with Word-compatible mime type
    const docxContent = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><title>ExamFit System-Handbuch</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
</head><body>${html}</body></html>`;
    downloadBlob(docxContent, 'examfit-system-handbuch.doc', 'application/msword');
  };

  const exportPDF = () => {
    const html = generateHTML(HANDBOOK_SECTIONS);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    }
  };

  const currentSection = HANDBOOK_SECTIONS.find(s => s.id === activeSection) || HANDBOOK_SECTIONS[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            System-Handbuch
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Technische Dokumentation · Workflows · Admin-FAQ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportJSX}>
            <FileCode className="h-3.5 w-3.5 mr-1.5" /> TXT Export
          </Button>
          <Button variant="outline" size="sm" onClick={exportDOCX}>
            <FileText className="h-3.5 w-3.5 mr-1.5" /> DOCX Export
          </Button>
          <Button variant="outline" size="sm" onClick={exportPDF}>
            <Printer className="h-3.5 w-3.5 mr-1.5" /> PDF Export
          </Button>
        </div>
      </div>

      <PageExplainer
        title="System-Handbuch & Workflows"
        description="Vollständige technische Dokumentation des ExamFit-Systems. Beschreibt alle Workflows, Architekturentscheidungen und Konfigurationen, um das System nachzubilden oder zu warten."
        actions={[
          'Navigiere durch die Kapitel links',
          'Exportiere das gesamte Handbuch als TXT, DOCX oder PDF',
          'Nutze die FAQ-Sektion für häufige Admin-Fragen',
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* TOC sidebar */}
        <Card className="lg:sticky lg:top-4 h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Kapitel</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <nav className="space-y-0.5">
              {HANDBOOK_SECTIONS.map(s => {
                const Icon = s.icon;
                const isActive = s.id === activeSection;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{s.title}</span>
                  </button>
                );
              })}
            </nav>
          </CardContent>
        </Card>

        {/* Content area */}
        <div ref={printRef} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {(() => { const Icon = currentSection.icon; return <Icon className="h-5 w-5 text-primary" />; })()}
                {currentSection.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {currentSection.content.map((block, i) => (
                <div key={i} className="space-y-2">
                  {block.heading && (
                    <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                      <ChevronRight className="h-4 w-4 text-primary" />
                      {block.heading}
                    </h3>
                  )}
                  {block.text && (
                    <p className="text-sm text-muted-foreground leading-relaxed pl-6">{block.text}</p>
                  )}
                  {block.list && (
                    <ul className="space-y-1.5 pl-6">
                      {block.list.map((li, j) => (
                        <li key={j} className="text-sm text-foreground flex items-start gap-2">
                          <span className="text-primary mt-1 shrink-0">•</span>
                          <span>{li}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {block.table && (
                    <div className="pl-6 overflow-x-auto">
                      <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                        <thead>
                          <tr className="bg-muted/50">
                            {block.table.headers.map((h, j) => (
                              <th key={j} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground border-b border-border">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {block.table.rows.map((row, j) => (
                            <tr key={j} className="border-b border-border/50 last:border-0">
                              {row.map((cell, k) => (
                                <td key={k} className="px-3 py-2 text-foreground">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {block.note && (
                    <div className="pl-6">
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
                        <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        <p className="text-xs text-foreground">{block.note}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
