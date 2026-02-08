import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  BookOpen, 
  ChevronDown, 
  Mic, 
  Brain, 
  GraduationCap, 
  ClipboardCheck,
  Shield,
  Activity,
  Database,
  Bot,
  FileText,
  Settings,
  Users,
  ShoppingCart,
  BarChart3,
  CheckCircle2,
  Clock,
  AlertCircle
} from 'lucide-react';

interface FeatureDoc {
  id: string;
  title: string;
  icon: React.ReactNode;
  status: 'active' | 'beta' | 'planned';
  lastUpdated: string;
  description: string;
  workflow: string[];
  technicalDetails: {
    label: string;
    value: string;
  }[];
  apiEndpoints?: string[];
  relatedTables?: string[];
  notes?: string[];
}

const documentationData: FeatureDoc[] = [
  {
    id: 'oral-exam-trainer',
    title: 'Mündliche Prüfungssimulation (OralExamTrainer)',
    icon: <Mic className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'KI-gestützte Simulation der mündlichen IHK-Prüfung mit Sprachaufnahme und automatischer Bewertung.',
    workflow: [
      '1. Benutzer wählt Beruf und Themenbereich aus',
      '2. System generiert kontextuelle Prüfungsfrage via KI (oral-exam Edge Function)',
      '3. Text-to-Speech (Web SpeechSynthesis API) liest die Frage automatisch vor',
      '4. Nach TTS-Ende wechselt System automatisch in Listening-Modus',
      '5. Sprachaufnahme (Web Speech API - webkitSpeechRecognition) transkribiert Antwort',
      '6. Benutzer beendet Aufnahme manuell oder nach Stille',
      '7. KI analysiert Antwort nach IHK-Kriterien (Fachlichkeit, Struktur, Begriffe, Praxis)',
      '8. Bewertung mit Score (0-100), Stärken, Verbesserungen wird angezeigt',
      '9. Musterantwort per Toggle abrufbar',
      '10. Mögliche Prüfer-Nachfrage wird generiert',
      '11. Benutzer kann nächste Frage starten oder Session beenden'
    ],
    technicalDetails: [
      { label: 'Edge Function', value: 'supabase/functions/oral-exam/index.ts' },
      { label: 'Frontend', value: 'src/pages/OralExamTrainer.tsx' },
      { label: 'Hook', value: 'src/hooks/useOralExam.ts' },
      { label: 'Speech API', value: 'Web Speech API (STT) + SpeechSynthesis (TTS)' },
      { label: 'AI Model', value: 'Claude 3.5 Sonnet via Lovable AI' },
      { label: 'Sprache', value: 'de-DE' }
    ],
    apiEndpoints: ['POST /functions/v1/oral-exam'],
    relatedTables: ['exam_sessions', 'oral_exam_results', 'question_blueprints'],
    notes: [
      'TTS startet automatisch nach Frage-Generierung',
      'STT startet automatisch nach TTS-Ende',
      'Bewertungskriterien: Fachlichkeit 40%, Struktur 25%, Begriffe 20%, Praxisbezug 15%'
    ]
  },
  {
    id: 'five-step-didactic',
    title: '5-Schritte-Didaktik (Lernkurs-System)',
    icon: <GraduationCap className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Strukturiertes Lernmodell mit fünf aufeinander aufbauenden didaktischen Phasen pro Kompetenz.',
    workflow: [
      '1. EINSTIEG (10 Min): Aktivierung von Vorwissen, Neugier wecken',
      '   → H5P-Typ: ImageHotspots, CoursePresentation',
      '2. VERSTEHEN (25 Min): Wissensvermittlung, Erklärungen, Beispiele',
      '   → H5P-Typ: InteractiveVideo, Accordion',
      '3. ANWENDEN (30 Min): Praktische Übungen, Fallbeispiele',
      '   → H5P-Typ: BranchingScenario, DragText',
      '4. WIEDERHOLEN (15 Min): Festigung durch Wiederholung',
      '   → H5P-Typ: Flashcards, MemoryGame',
      '5. MINI-CHECK (10 Min): Lernerfolgskontrolle',
      '   → H5P-Typ: QuestionSet mit Mindestpunktzahl'
    ],
    technicalDetails: [
      { label: 'Generator', value: 'supabase/functions/generate-course/index.ts' },
      { label: 'Lesson Player', value: 'src/pages/LessonPlayer.tsx' },
      { label: 'H5P Integration', value: 'src/components/lesson/H5PPlayer.tsx' },
      { label: 'Progress Tracking', value: 'src/hooks/useCourseProgress.ts' },
      { label: 'Step Types', value: 'einstieg | verstehen | anwenden | wiederholen | mini_check' }
    ],
    relatedTables: ['courses', 'lessons', 'lesson_progress', 'competencies'],
    notes: [
      'Jede Kompetenz erhält genau 5 Lektionen (eine pro Schritt)',
      'Mini-Check muss mit ≥70% bestanden werden',
      'Progress wird automatisch getrackt und in lesson_progress gespeichert'
    ]
  },
  {
    id: 'exam-trainer',
    title: 'Schriftlicher Prüfungstrainer (Blueprint-System)',
    icon: <ClipboardCheck className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'IHK-konforme Prüfungssimulation mit Blueprint-basierter Fragengenerierung und adaptiver Schwierigkeit.',
    workflow: [
      '1. Admin erstellt/wählt Blueprint-Template für Prüfungstyp',
      '2. Blueprint definiert: Lernfeld-Gewichtung, Taxonomie-Verteilung, Fragenanzahl',
      '3. System generiert Fragen via KI basierend auf Blueprint-Variablen',
      '4. Fragen werden validiert (4 Optionen, korrekte Antwort, Erklärung)',
      '5. Learner startet Prüfungssession',
      '6. Fragen werden nach Blueprint-Gewichtung zusammengestellt',
      '7. Adaptive Schwierigkeit basierend auf Streak/Performance',
      '8. Session-Snapshot wird in exam_session_questions gespeichert',
      '9. Nach Abschluss: Detaillierte Ergebnisanalyse',
      '10. Schwache Kompetenzen (<70%) werden mit Lektionen verknüpft'
    ],
    technicalDetails: [
      { label: 'Blueprint Generator', value: 'supabase/functions/generate-blueprint-questions/index.ts' },
      { label: 'Simulation Hook', value: 'src/hooks/useExamSimulation.ts' },
      { label: 'Results Page', value: 'src/pages/ExamResultsPage.tsx' },
      { label: 'Blueprint Editor', value: 'src/pages/admin/ExamBlueprintsPage.tsx' },
      { label: 'Schwierigkeitsverteilung', value: 'leicht 20% | mittel 50% | schwer 30%' }
    ],
    apiEndpoints: ['POST /functions/v1/generate-blueprint-questions'],
    relatedTables: ['question_blueprints', 'blueprint_variables', 'blueprint_variants', 'exam_questions', 'exam_sessions', 'exam_session_questions'],
    notes: [
      'Blueprints sind versioniert (Audit-Log bei Änderungen)',
      'Deterministische Seeds für Reproduzierbarkeit',
      'Taxonomie-Level nach Bloom: Erinnern → Erschaffen'
    ]
  },
  {
    id: 'ai-tutor',
    title: 'KI-Tutor (Kontextueller Lernbegleiter)',
    icon: <Bot className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Didaktischer KI-Assistent mit strenger Kontextbindung und modusabhängiger Governance.',
    workflow: [
      '1. Tutor-Panel wird in Lesson/Exam-Kontext geöffnet',
      '2. System ermittelt aktuellen Modus: learning | practice | exam',
      '3. Kontext wird geladen: Curriculum, Kompetenz, Lektion, Lernhistorie',
      '4. User stellt Frage im Chat-Interface',
      '5. Prompt wird mit SSOT-Kontext angereichert',
      '6. AI-Tutor Edge Function verarbeitet Anfrage',
      '7. Im Exam-Modus: Nur technische Hilfe erlaubt (keine inhaltliche Unterstützung)',
      '8. Antwort wird mit Quellenreferenz zurückgegeben',
      '9. Interaktion wird in ai_tutor_logs protokolliert'
    ],
    technicalDetails: [
      { label: 'Edge Function', value: 'supabase/functions/ai-tutor/index.ts' },
      { label: 'UI Component', value: 'src/components/tutor/TutorPanel.tsx' },
      { label: 'Chat Component', value: 'src/components/tutor/AITutorChat.tsx' },
      { label: 'Hook', value: 'src/hooks/useAITutor.ts' },
      { label: 'Modi', value: 'learning (voll) | practice (eingeschränkt) | exam (nur technisch)' }
    ],
    relatedTables: ['ai_tutor_logs', 'lesson_progress', 'exam_sessions'],
    notes: [
      'Governance serverseitig erzwungen - nicht umgehbar',
      'Alle Antworten SSOT-gebunden (kein Halluzinieren)',
      'Rollen: Erklärer, Coach, Prüfer, Feedback-Geber'
    ]
  },
  {
    id: 'curriculum-pipeline',
    title: 'Curriculum-Pipeline (Extraktion & Normalisierung)',
    icon: <FileText className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Automatisierte Verarbeitung von Rahmenlehrplänen zu strukturierten Curriculum-Daten.',
    workflow: [
      '1. Admin lädt PDF/DOCX des Rahmenlehrplans hoch',
      '2. Datei wird in Storage (curriculum-files) gespeichert',
      '3. Job wird in job_queue erstellt (job_type: extract_curriculum)',
      '4. Edge Function extract-curriculum verarbeitet Dokument',
      '5. KI extrahiert: Lernfelder, Kompetenzen, Zeitrichtwerte',
      '6. Daten werden normalisiert und validiert',
      '7. Status wechselt: draft → extracting → normalizing → frozen',
      '8. Gefrorenes Curriculum ist SSOT für alle Produkte',
      '9. Änderungen nach Freeze nur durch neue Version möglich'
    ],
    technicalDetails: [
      { label: 'Upload UI', value: 'src/pages/admin/CurriculumImport.tsx' },
      { label: 'Extractor', value: 'supabase/functions/extract-curriculum/index.ts' },
      { label: 'Detail View', value: 'src/pages/admin/CurriculumDetail.tsx' },
      { label: 'Status Enum', value: 'draft | extracting | normalizing | frozen' }
    ],
    relatedTables: ['curricula', 'learning_fields', 'competencies', 'job_queue'],
    notes: [
      'Nur frozen Curricula können Kurse/Prüfungen generieren',
      'BIBB-Referenz wird automatisch verknüpft wenn vorhanden',
      'Extrahierte Daten werden in extracted_data JSON gespeichert'
    ]
  },
  {
    id: 'job-system',
    title: 'Job-Queue-System (Background Processing)',
    icon: <Activity className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Zustandsbasierte Job-Verarbeitung für asynchrone Aufgaben mit Retry-Logic.',
    workflow: [
      '1. Job wird mit Status "pending" in job_queue erstellt',
      '2. Worker (Edge Function/Cron) pollt pending Jobs',
      '3. Job wechselt zu "processing", started_at wird gesetzt',
      '4. Verarbeitung läuft (z.B. Kurs-Generierung)',
      '5. Bei Erfolg: Status → "completed", result wird gespeichert',
      '6. Bei Fehler: attempts++, error wird geloggt',
      '7. Wenn attempts >= max_attempts: Status → "failed"',
      '8. Failed Jobs landen im Dead-Letter-Bereich',
      '9. Admin kann Jobs manuell retrigger oder archivieren'
    ],
    technicalDetails: [
      { label: 'Dashboard', value: 'src/pages/admin/JobsDashboard.tsx' },
      { label: 'Job List', value: 'src/pages/admin/JobsList.tsx' },
      { label: 'Dead Letter', value: 'src/pages/admin/JobDeadLetter.tsx' },
      { label: 'Job Types', value: 'extract_curriculum | generate_course | generate_questions | generate_evidence_pack' },
      { label: 'Max Attempts', value: '3 (default)' }
    ],
    relatedTables: ['job_queue', 'ai_worker_policies', 'ai_worker_usage_daily'],
    notes: [
      'Alle Jobs referenzieren curriculum_id (UUID, niemals Slugs!)',
      'AI Worker Policies steuern Rate Limits und Kosten',
      'Daily Usage wird aggregiert für Budget-Tracking'
    ]
  },
  {
    id: 'azav-compliance',
    title: 'AZAV-Compliance-System',
    icon: <Shield className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Qualitätsmanagementsystem für AZAV-Zertifizierung nach §178-179 SGB III.',
    workflow: [
      '1. QM-Dokumente werden im System erfasst (qm_documents)',
      '2. Fachbereiche (1-6) werden konfiguriert',
      '3. Pro Kurs wird Maßnahmen-Zulassung angelegt',
      '4. Automatisierte Compliance-Checks laufen (run_azav_compliance_check)',
      '5. Compliance-Score wird berechnet',
      '6. Fehlende Anforderungen werden angezeigt',
      '7. Audit-Log dokumentiert alle Prüfungen',
      '8. Evidence Packs werden für Zertifizierungsstelle generiert'
    ],
    technicalDetails: [
      { label: 'Dashboard', value: 'src/pages/admin/AZAVCompliancePage.tsx' },
      { label: 'Evidence Generator', value: 'supabase/functions/generate-evidence-pack/index.ts' },
      { label: 'Audit Export', value: 'src/pages/admin/AuditExportsPage.tsx' },
      { label: 'Fachbereiche', value: '1-6 nach SGB III' }
    ],
    relatedTables: ['qm_documents', 'azav_fachbereiche', 'azav_massnahmen_zulassungen', 'azav_compliance_checks', 'azav_compliance_results', 'azav_audit_log', 'course_evidence_packs'],
    notes: [
      'Trägerzulassung = Einrichtungsprüfung',
      'Maßnahmenzulassung = Kursprüfung',
      '20+ automatisierte Prüfpunkte implementiert'
    ]
  },
  {
    id: 'spaced-repetition',
    title: 'Spaced Repetition (SM-2 Algorithmus)',
    icon: <Brain className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Intelligentes Wiederholungssystem mit Bloom-Taxonomie-Modifikatoren.',
    workflow: [
      '1. Frage wird beantwortet (richtig/falsch)',
      '2. SM-2 Algorithmus berechnet neues Intervall',
      '3. Bloom-Level modifiziert Intervall (höhere Taxonomie = kürzeres Intervall)',
      '4. next_review_at wird gesetzt',
      '5. Tägliche Session zeigt fällige Karten',
      '6. Easiness Factor wird angepasst (2.5 Default)',
      '7. Streak beeinflusst Confidence-Score'
    ],
    technicalDetails: [
      { label: 'Edge Function', value: 'supabase/functions/spaced-repetition/index.ts' },
      { label: 'Session Page', value: 'src/pages/SpacedRepetitionSession.tsx' },
      { label: 'Algorithmus', value: 'SM-2 (SuperMemo 2)' },
      { label: 'Bloom Modifier', value: '0.8 (Erinnern) bis 1.3 (Erschaffen)' }
    ],
    relatedTables: ['spaced_repetition_cards', 'exam_questions'],
    notes: [
      'Minimum Interval: 1 Tag',
      'Maximum Interval: 365 Tage',
      'Fällige Karten werden nach Priorität sortiert'
    ]
  },
  {
    id: 'shop-entitlements',
    title: 'Shop & Berechtigungen',
    icon: <ShoppingCart className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Stripe-Integration für Produktverkauf mit automatischer Berechtigungszuweisung.',
    workflow: [
      '1. Produkte werden in Stripe angelegt',
      '2. Shop-Seite zeigt verfügbare Produkte',
      '3. User startet Checkout (create-checkout Edge Function)',
      '4. Stripe Checkout Session wird erstellt',
      '5. Nach Zahlung: Webhook empfängt Event',
      '6. verify-purchase validiert Zahlung',
      '7. Entitlement wird in entitlements-Tabelle erstellt',
      '8. User erhält Zugang zu gekauften Features',
      '9. Paywall-Komponente prüft Berechtigungen'
    ],
    technicalDetails: [
      { label: 'Shop Page', value: 'src/pages/ShopPage.tsx' },
      { label: 'Checkout', value: 'supabase/functions/create-checkout/index.ts' },
      { label: 'Verification', value: 'supabase/functions/verify-purchase/index.ts' },
      { label: 'Hook', value: 'src/hooks/useEntitlements.ts' },
      { label: 'Paywall', value: 'src/components/shop/Paywall.tsx' }
    ],
    relatedTables: ['entitlements', 'license_seats', 'course_bundles'],
    notes: [
      'Entitlements haben Ablaufdatum (valid_until)',
      'Features: has_learning_course, has_exam_trainer, has_oral_trainer, has_ai_tutor',
      'B2B: Seat-basierte Lizenzen möglich'
    ]
  },
  {
    id: 'bibb-seeding',
    title: 'BIBB-Berufe-Datenbank',
    icon: <Database className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Import und Pflege der offiziellen BIBB-Ausbildungsberufe.',
    workflow: [
      '1. BIBB-Daten werden via Edge Function importiert',
      '2. Berufe werden in berufe-Tabelle gespeichert',
      '3. Verordnungs-PDFs werden referenziert',
      '4. Curricula werden mit Beruf verknüpft (beruf_id)',
      '5. Automatische Metadaten: DQR-Niveau, Ausbildungsdauer, KLDB-Code'
    ],
    technicalDetails: [
      { label: 'Seeder', value: 'supabase/functions/bibb-seeding/index.ts' },
      { label: 'Admin Page', value: 'src/pages/admin/BIBBSeedingPage.tsx' },
      { label: 'Datenquelle', value: 'BIBB (bibb.de)' }
    ],
    relatedTables: ['berufe', 'beruf_dokumente', 'curricula'],
    notes: [
      'bibb_id ist eindeutiger Identifier',
      'Gültigkeitszeitraum wird gepflegt',
      'Zuständigkeit: IHK, HWK, etc.'
    ]
  },
  {
    id: 'analytics-kpi',
    title: 'Analytics & KPI-Dashboard',
    icon: <BarChart3 className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Business Intelligence mit Echtzeit-KPIs und AI-Kostentracking.',
    workflow: [
      '1. Events werden in entsprechenden Tabellen geloggt',
      '2. Aggregierte Views berechnen KPIs',
      '3. Dashboard zeigt: Umsatz, Learner-Aktivität, Completion Rates',
      '4. AI-Kosten werden pro Request getrackt',
      '5. Budget-Alerts bei 80% Auslastung',
      '6. Tägliche Aggregation in ai_worker_usage_daily'
    ],
    technicalDetails: [
      { label: 'KPI Dashboard', value: 'src/pages/admin/KPIDashboard.tsx' },
      { label: 'System Audit', value: 'src/pages/admin/SystemAuditPage.tsx' },
      { label: 'Budget Trigger', value: 'check_ai_budget_alert()' },
      { label: 'Monthly Budget', value: '200 EUR (konfigurierbar)' }
    ],
    relatedTables: ['ai_usage_log', 'ai_cost_budgets', 'ai_worker_usage_daily', 'performance_metrics'],
    notes: [
      'Alert bei 80% Budget-Auslastung',
      'Kosten werden pro Token berechnet',
      'Performance Metrics: p50, p95, p99 Latenz'
    ]
  },
  {
    id: 'mobile-native-app',
    title: 'Mobile Native App (iOS & Android)',
    icon: <Settings className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Capacitor-basierte Native App für iOS und Android mit PWA-Fallback.',
    workflow: [
      '1. PWA läuft als Web-App mit Offline-Support (Service Worker)',
      '2. Capacitor-Konfiguration ermöglicht Native-Build',
      '3. Safe Area Support für iOS (Notch, Dynamic Island)',
      '4. Native Tab Bar Navigation für Mobile UX',
      '5. Platform-Detection via useNativeApp Hook',
      '6. Für Store-Distribution: Projekt exportieren und lokal builden',
      '7. iOS: npx cap add ios → Xcode öffnen → Archive → App Store',
      '8. Android: npx cap add android → Android Studio → Signed APK → Play Store'
    ],
    technicalDetails: [
      { label: 'Capacitor Config', value: 'capacitor.config.ts' },
      { label: 'Native Hook', value: 'src/hooks/useNativeApp.ts' },
      { label: 'Safe Area View', value: 'src/components/native/SafeAreaView.tsx' },
      { label: 'Native Header', value: 'src/components/native/NativeHeader.tsx' },
      { label: 'Tab Bar', value: 'src/components/native/NativeTabBar.tsx' },
      { label: 'PWA Config', value: 'vite.config.ts (VitePWA Plugin)' },
      { label: 'App ID', value: 'app.lovable.ad51e8f96cff41cf9723b4e49dbcd9db' },
      { label: 'iOS Min Version', value: 'iOS 13+' },
      { label: 'Android Min Version', value: 'API 22 (Android 5.1)' }
    ],
    apiEndpoints: [],
    relatedTables: [],
    notes: [
      'PWA funktioniert sofort ohne Store-Veröffentlichung',
      'Capacitor ermöglicht Zugriff auf native Device-Features',
      'Hot-Reload während Entwicklung über Preview-URL',
      'Produktions-Build benötigt npm run build && npx cap sync',
      'Store-Automatisierung via Admin → App Store Builder'
    ]
  },
  {
    id: 'pwa-offline',
    title: 'Progressive Web App (Offline-Modus)',
    icon: <Settings className="h-5 w-5" />,
    status: 'active',
    lastUpdated: '2026-02-08',
    description: 'Offline-fähige Web-App mit Service Worker und Cache-Strategien.',
    workflow: [
      '1. Service Worker registriert sich automatisch (vite-plugin-pwa)',
      '2. Statische Assets werden beim ersten Load gecached',
      '3. Google Fonts werden 1 Jahr gecached (CacheFirst)',
      '4. API-Responses werden NetworkFirst gecached (24h TTL)',
      '5. Offline-Indicator zeigt Verbindungsstatus',
      '6. Bei Reconnect: Automatische Synchronisation',
      '7. Install-Prompt nach 30 Sekunden (wenn nicht dismissed)',
      '8. App kann auf Homescreen installiert werden'
    ],
    technicalDetails: [
      { label: 'Vite Plugin', value: 'vite-plugin-pwa' },
      { label: 'Manifest', value: 'Generiert via VitePWA Config' },
      { label: 'Offline Indicator', value: 'src/components/pwa/OfflineIndicator.tsx' },
      { label: 'Install Prompt', value: 'src/components/pwa/InstallPrompt.tsx' },
      { label: 'Install Page', value: 'src/pages/InstallPage.tsx' },
      { label: 'Cache Strategy', value: 'CacheFirst (Static) / NetworkFirst (API)' },
      { label: 'Theme Color', value: '#0F3D3E (Petrol)' }
    ],
    notes: [
      'iOS: Safari Share → Zum Home-Bildschirm',
      'Android: Browser-Menü → App installieren',
      'Prompt wird 7 Tage nach Dismiss nicht gezeigt',
      'Standalone-Modus ohne Browser-Chrome'
    ]
  }
];

const StatusBadge = ({ status }: { status: 'active' | 'beta' | 'planned' }) => {
  const config = {
    active: { label: 'Aktiv', variant: 'default' as const, icon: <CheckCircle2 className="h-3 w-3" /> },
    beta: { label: 'Beta', variant: 'secondary' as const, icon: <Clock className="h-3 w-3" /> },
    planned: { label: 'Geplant', variant: 'outline' as const, icon: <AlertCircle className="h-3 w-3" /> }
  };
  
  const { label, variant, icon } = config[status];
  
  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {label}
    </Badge>
  );
};

const FeatureDocCard = ({ feature }: { feature: FeatureDoc }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="glass-card">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  {feature.icon}
                </div>
                <div className="text-left">
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                  <CardDescription className="mt-1">{feature.description}</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={feature.status} />
                <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            {/* Workflow */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Workflow
              </h4>
              <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                {feature.workflow.map((step, idx) => (
                  <div key={idx} className="text-sm font-mono text-muted-foreground">
                    {step}
                  </div>
                ))}
              </div>
            </div>
            
            {/* Technical Details */}
            <div>
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" />
                Technische Details
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {feature.technicalDetails.map((detail, idx) => (
                  <div key={idx} className="flex justify-between items-center bg-muted/20 rounded-lg px-3 py-2">
                    <span className="text-sm font-medium">{detail.label}</span>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{detail.value}</code>
                  </div>
                ))}
              </div>
            </div>
            
            {/* API Endpoints */}
            {feature.apiEndpoints && feature.apiEndpoints.length > 0 && (
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  API Endpoints
                </h4>
                <div className="flex flex-wrap gap-2">
                  {feature.apiEndpoints.map((endpoint, idx) => (
                    <Badge key={idx} variant="outline" className="font-mono text-xs">
                      {endpoint}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {/* Related Tables */}
            {feature.relatedTables && feature.relatedTables.length > 0 && (
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  Datenbank-Tabellen
                </h4>
                <div className="flex flex-wrap gap-2">
                  {feature.relatedTables.map((table, idx) => (
                    <Badge key={idx} variant="secondary" className="font-mono text-xs">
                      {table}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {/* Notes */}
            {feature.notes && feature.notes.length > 0 && (
              <div>
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Hinweise
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {feature.notes.map((note, idx) => (
                    <li key={idx} className="text-sm text-muted-foreground">{note}</li>
                  ))}
                </ul>
              </div>
            )}
            
            <div className="text-xs text-muted-foreground pt-4 border-t">
              Zuletzt aktualisiert: {feature.lastUpdated}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
};

export default function DocumentationPage() {
  const categories = {
    learning: documentationData.filter(f => ['oral-exam-trainer', 'five-step-didactic', 'exam-trainer', 'ai-tutor', 'spaced-repetition'].includes(f.id)),
    admin: documentationData.filter(f => ['curriculum-pipeline', 'job-system', 'bibb-seeding'].includes(f.id)),
    compliance: documentationData.filter(f => ['azav-compliance'].includes(f.id)),
    business: documentationData.filter(f => ['shop-entitlements', 'analytics-kpi'].includes(f.id))
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-primary" />
            System-Dokumentation
          </h1>
          <p className="text-muted-foreground mt-1">
            Vollständiges Handbuch aller Workflows und Funktionen
          </p>
        </div>
        <Badge variant="outline" className="text-sm">
          {documentationData.length} Funktionen dokumentiert
        </Badge>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CheckCircle2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{documentationData.filter(f => f.status === 'active').length}</p>
                <p className="text-xs text-muted-foreground">Aktive Features</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{categories.learning.length}</p>
                <p className="text-xs text-muted-foreground">Lern-Features</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{categories.compliance.length}</p>
                <p className="text-xs text-muted-foreground">Compliance</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{categories.business.length}</p>
                <p className="text-xs text-muted-foreground">Business</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Documentation Tabs */}
      <Tabs defaultValue="learning" className="space-y-6">
        <TabsList className="glass-card">
          <TabsTrigger value="learning" className="gap-2">
            <GraduationCap className="h-4 w-4" />
            Lernsystem
          </TabsTrigger>
          <TabsTrigger value="admin" className="gap-2">
            <Settings className="h-4 w-4" />
            Administration
          </TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2">
            <Shield className="h-4 w-4" />
            Compliance
          </TabsTrigger>
          <TabsTrigger value="business" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Business
          </TabsTrigger>
          <TabsTrigger value="all" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Alle
          </TabsTrigger>
        </TabsList>

        <TabsContent value="learning">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-4 pr-4">
              {categories.learning.map(feature => (
                <FeatureDocCard key={feature.id} feature={feature} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="admin">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-4 pr-4">
              {categories.admin.map(feature => (
                <FeatureDocCard key={feature.id} feature={feature} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="compliance">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-4 pr-4">
              {categories.compliance.map(feature => (
                <FeatureDocCard key={feature.id} feature={feature} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="business">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-4 pr-4">
              {categories.business.map(feature => (
                <FeatureDocCard key={feature.id} feature={feature} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="all">
          <ScrollArea className="h-[calc(100vh-400px)]">
            <div className="space-y-4 pr-4">
              {documentationData.map(feature => (
                <FeatureDocCard key={feature.id} feature={feature} />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
