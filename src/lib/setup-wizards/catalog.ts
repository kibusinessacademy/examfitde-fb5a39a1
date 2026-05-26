/**
 * Premium UX — One-Click Setup Wizards Catalog (SSOT)
 *
 * Pure code-side SSOT. State lives in `enterprise_setup_wizard_state`.
 * Each entry registers a wizard the org can configure with minimal friction.
 *
 * Bridges:
 *  - `existing_route` points to already-shipped tools (SSO/SCIM/API Keys/Bulk Import)
 *    so we do NOT rebuild them — we only wrap them in the unified Premium UX layer.
 *  - `connector_id` lets the runner deep-link to the standard_connectors flow.
 *  - `steps` defines the lightweight on-boarding flow for new integrations
 *    that have no dedicated wizard yet.
 */

export type WizardCategory =
  | 'identity'        // SSO / SCIM / Domains
  | 'workspace'       // Slack / Teams / Email
  | 'hr'              // HRIS / Bulk Import / SCIM Provisioning
  | 'lms'             // LMS / LTI
  | 'crm'             // HubSpot / Salesforce
  | 'devtools'        // GitHub / Linear
  | 'ai_provider'     // Lovable AI Gateway / OpenAI / Anthropic
  | 'billing'         // Stripe
  | 'analytics'       // GA4 / GTM / Search Console
  | 'webinar'         // Zoom / Teams Meetings
  | 'knowledge';      // Notion / Google Drive / Confluence

export type WizardTier = 'core' | 'pro' | 'business' | 'enterprise';

export interface WizardStepDef {
  key: string;
  label: string;
  description: string;
  /** Optional input fields the runner renders as a small form. */
  fields?: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'url' | 'email' | 'textarea';
    placeholder?: string;
    optional?: boolean;
  }>;
}

export interface WizardDef {
  key: string;
  label: string;
  vendor: string;
  category: WizardCategory;
  tier: WizardTier;
  /** Short marketing-grade promise: "what the customer no longer has to do". */
  promise: string;
  estimated_minutes: number;
  /** When set, the hub deep-links to this existing tool instead of running steps. */
  existing_route?: string;
  /** When set, the runner triggers the Lovable connector flow. */
  connector_id?: string;
  /** Inline steps for wizards that don't have an existing tool yet. */
  steps?: WizardStepDef[];
  /** Inputs the customer needs handy ("Was du brauchst"). */
  prerequisites?: string[];
}

export const WIZARD_CATEGORIES: Record<WizardCategory, { label: string; description: string }> = {
  identity:    { label: 'Identität & SSO',       description: 'Single Sign-On, SCIM, Domain Mapping.' },
  workspace:   { label: 'Workspace',             description: 'Slack, Microsoft Teams, Outlook.' },
  hr:          { label: 'HR & Belegschaft',      description: 'HRIS, Bulk-Import, Lerner-Provisioning.' },
  lms:         { label: 'LMS & LTI',             description: 'Lernplattformen, LTI 1.3, Single-Course-Embed.' },
  crm:         { label: 'CRM & Vertrieb',        description: 'HubSpot, Salesforce, Pipedrive.' },
  devtools:    { label: 'Engineering & Tickets', description: 'GitHub, Linear, Jira.' },
  ai_provider: { label: 'KI-Provider',           description: 'Lovable AI Gateway & alternative LLM-Provider.' },
  billing:     { label: 'Billing',               description: 'Stripe, Rechnungen, Subscription-Lifecycle.' },
  analytics:   { label: 'Analytics & GTM',       description: 'GA4, Google Tag Manager, Search Console.' },
  webinar:     { label: 'Webinar & Meeting',     description: 'Zoom, Teams Meetings, Live-Sessions.' },
  knowledge:   { label: 'Unternehmenswissen',    description: 'Notion, Google Drive, Confluence, SharePoint.' },
};

export const WIZARDS: WizardDef[] = [
  // --- Identität & SSO ---------------------------------------------------
  {
    key: 'sso_saml_oidc',
    label: 'SSO (SAML / OIDC)',
    vendor: 'Azure AD · Okta · Google Workspace',
    category: 'identity',
    tier: 'enterprise',
    promise: 'Mitarbeitende loggen sich mit ihrem Unternehmens-Account ein — keine Passwörter, kein Onboarding.',
    estimated_minutes: 8,
    existing_route: '/admin/v2/leitstelle?tab=integrations&sub=sso',
    prerequisites: ['IdP-Metadaten-URL', 'Domain für Auto-Provisioning'],
  },
  {
    key: 'scim_provisioning',
    label: 'SCIM Provisioning',
    vendor: 'Azure AD · Okta · OneLogin',
    category: 'identity',
    tier: 'enterprise',
    promise: 'Neue Mitarbeitende landen automatisch im richtigen Lernpfad. Austritte werden sofort entzogen.',
    estimated_minutes: 6,
    existing_route: '/admin/v2/leitstelle?tab=integrations&sub=scim',
    prerequisites: ['SCIM-Bearer-Token (wird vom Wizard erzeugt)'],
  },

  // --- HR & Belegschaft --------------------------------------------------
  {
    key: 'bulk_import_csv',
    label: 'CSV / XLSX Lerner-Import',
    vendor: 'Excel · HRIS-Export',
    category: 'hr',
    tier: 'business',
    promise: 'Lade einmal eine Liste hoch — Validierung, Dry-Run und Rollback sind eingebaut.',
    estimated_minutes: 4,
    existing_route: '/admin/v2/leitstelle?tab=integrations&sub=bulk',
    prerequisites: ['Liste mit E-Mail, Name, optional Abteilung'],
  },
  {
    key: 'hris_personio',
    label: 'Personio HRIS-Sync',
    vendor: 'Personio',
    category: 'hr',
    tier: 'enterprise',
    promise: 'Stammdaten synchronisieren — Cohorts, Standorte und Rollen entstehen automatisch.',
    estimated_minutes: 10,
    steps: [
      { key: 'api', label: 'API-Zugang', description: 'Personio Client-ID + Secret hinterlegen.',
        fields: [
          { key: 'client_id', label: 'Client-ID', type: 'text' },
          { key: 'client_secret', label: 'Client-Secret', type: 'password' },
        ] },
      { key: 'mapping', label: 'Feld-Mapping', description: 'Abteilungen → Cohorts, Standorte → Locations.' },
      { key: 'test', label: 'Test-Sync', description: 'Dry-Run mit 5 Mitarbeitenden.' },
    ],
    prerequisites: ['Personio API-Credentials (Admin)'],
  },

  // --- Workspace ---------------------------------------------------------
  {
    key: 'slack_workspace',
    label: 'Slack-Workspace',
    vendor: 'Slack',
    category: 'workspace',
    tier: 'business',
    promise: 'Alerts, Risk-Radar-Hinweise und Cohort-Updates direkt im Team-Channel.',
    estimated_minutes: 3,
    connector_id: 'slack',
    prerequisites: ['Slack-Workspace-Admin'],
  },
  {
    key: 'microsoft_teams',
    label: 'Microsoft Teams',
    vendor: 'Microsoft 365',
    category: 'workspace',
    tier: 'business',
    promise: 'Lern- und Manager-Benachrichtigungen ohne weiteres Tool.',
    estimated_minutes: 4,
    connector_id: 'microsoft_teams',
  },
  {
    key: 'outlook_email',
    label: 'Outlook / Microsoft 365 Mail',
    vendor: 'Microsoft 365',
    category: 'workspace',
    tier: 'business',
    promise: 'Lernreminder, Recovery-Mails und Onboarding-Sequenzen aus eurem Postfach.',
    estimated_minutes: 3,
    connector_id: 'microsoft_outlook',
  },

  // --- LMS & LTI ---------------------------------------------------------
  {
    key: 'lti_1_3',
    label: 'LMS-Integration (LTI 1.3)',
    vendor: 'Moodle · Canvas · ILIAS · Open edX',
    category: 'lms',
    tier: 'enterprise',
    promise: 'Lerner starten ExamFit aus eurem bestehenden LMS — kein zweiter Login.',
    estimated_minutes: 12,
    steps: [
      { key: 'register', label: 'Tool-Registrierung', description: 'LMS-Issuer + Client-ID hinterlegen.',
        fields: [
          { key: 'issuer', label: 'Issuer-URL', type: 'url', placeholder: 'https://moodle.example.com' },
          { key: 'client_id', label: 'Client-ID', type: 'text' },
          { key: 'keyset_url', label: 'JWKS-URL', type: 'url' },
        ] },
      { key: 'launch', label: 'Launch-URLs übernehmen', description: 'ACS-/Launch-URLs ins LMS kopieren.' },
      { key: 'test', label: 'Launch-Test', description: 'Test-Launch eines Demo-Kurses ausführen.' },
    ],
    prerequisites: ['LMS-Admin-Zugang'],
  },

  // --- CRM & Vertrieb ----------------------------------------------------
  {
    key: 'hubspot_crm',
    label: 'HubSpot CRM',
    vendor: 'HubSpot',
    category: 'crm',
    tier: 'pro',
    promise: 'Trial-Leads, B2B-Anfragen und Aktivierungs-Events landen automatisch im CRM.',
    estimated_minutes: 5,
    connector_id: 'hubspot',
  },

  // --- DevTools ----------------------------------------------------------
  {
    key: 'github_repo',
    label: 'GitHub Workspace',
    vendor: 'GitHub',
    category: 'devtools',
    tier: 'pro',
    promise: 'Audit-Findings und Releases automatisch dokumentiert.',
    estimated_minutes: 4,
    steps: [
      { key: 'app', label: 'GitHub-App installieren', description: 'BerufOS-App im Org-Account installieren.' },
      { key: 'repo', label: 'Repository wählen', description: 'Welches Repo soll Audit-Logs empfangen?',
        fields: [{ key: 'repo', label: 'owner/repo', type: 'text', placeholder: 'acme/learning-ops' }] },
    ],
  },
  {
    key: 'linear_issues',
    label: 'Linear Issue-Sync',
    vendor: 'Linear',
    category: 'devtools',
    tier: 'pro',
    promise: 'Audit-Befunde landen direkt als Tickets im richtigen Team.',
    estimated_minutes: 3,
    connector_id: 'linear',
  },

  // --- AI Provider -------------------------------------------------------
  {
    key: 'ai_gateway_default',
    label: 'Lovable AI Gateway',
    vendor: 'Lovable',
    category: 'ai_provider',
    tier: 'core',
    promise: 'Standard-LLM-Backend — bereits aktiv. Keine eigenen API-Keys nötig.',
    estimated_minutes: 1,
    steps: [
      { key: 'confirm', label: 'Bestätigen', description: 'Lovable AI Gateway als Default bestätigen.' },
    ],
  },

  // --- Billing -----------------------------------------------------------
  {
    key: 'stripe_billing',
    label: 'Stripe Billing',
    vendor: 'Stripe',
    category: 'billing',
    tier: 'business',
    promise: 'Checkout, Rechnungen, Refunds — alles eingerichtet. Eure Buchhaltung sieht nur saubere Belege.',
    estimated_minutes: 5,
    steps: [
      { key: 'mode', label: 'Test oder Live', description: 'Mit Test-Mode starten oder direkt Live?' },
      { key: 'webhook', label: 'Webhook bestätigen', description: 'Stripe-Webhook ist serverseitig vorkonfiguriert — nur einmal bestätigen.' },
      { key: 'tax', label: 'Steuer-Profil', description: 'Standard MwSt. (DE/AT/CH) oder eigenes Setup.' },
    ],
    prerequisites: ['Stripe-Account (oder neu anlegen)'],
  },

  // --- Analytics & GTM ---------------------------------------------------
  {
    key: 'ga4_gtm',
    label: 'GA4 + Google Tag Manager',
    vendor: 'Google',
    category: 'analytics',
    tier: 'pro',
    promise: 'Conversion-Tracking, Funnel-Analyse und Cohort-Reports ohne Dev-Ticket.',
    estimated_minutes: 4,
    steps: [
      { key: 'ids', label: 'IDs hinterlegen', description: 'GA4 Measurement-ID + GTM-Container-ID.',
        fields: [
          { key: 'ga4_measurement_id', label: 'GA4 Measurement-ID', type: 'text', placeholder: 'G-XXXXXXX' },
          { key: 'gtm_container_id', label: 'GTM-Container', type: 'text', placeholder: 'GTM-XXXXXX' },
        ] },
      { key: 'verify', label: 'Verifizieren', description: 'Test-Event prüfen.' },
    ],
  },
  {
    key: 'search_console',
    label: 'Google Search Console',
    vendor: 'Google',
    category: 'analytics',
    tier: 'pro',
    promise: 'SEO-Performance pro Persona-Landing im BerufOS-Cockpit.',
    estimated_minutes: 3,
    connector_id: 'google_search_console',
  },

  // --- Webinar -----------------------------------------------------------
  {
    key: 'zoom_webinars',
    label: 'Zoom Meetings & Webinars',
    vendor: 'Zoom',
    category: 'webinar',
    tier: 'business',
    promise: 'Live-Sessions, Aufzeichnungen und Anwesenheit direkt im Lernpfad.',
    estimated_minutes: 4,
    steps: [
      { key: 'oauth', label: 'Zoom verbinden', description: 'Zoom-Workspace per OAuth verbinden.' },
      { key: 'defaults', label: 'Standard-Settings', description: 'Aufzeichnung, Wartesaal, automatische Einladung.' },
    ],
  },

  // --- Knowledge ---------------------------------------------------------
  {
    key: 'notion_knowledge',
    label: 'Notion-Wissensdatenbank',
    vendor: 'Notion',
    category: 'knowledge',
    tier: 'pro',
    promise: 'Eure SOPs werden zum Tutor-Wissen — automatisch, mit Quellenangabe.',
    estimated_minutes: 5,
    connector_id: 'notion',
  },
  {
    key: 'google_drive_knowledge',
    label: 'Google Drive',
    vendor: 'Google',
    category: 'knowledge',
    tier: 'pro',
    promise: 'Eure Schulungs-PDFs werden indiziert — der Tutor zitiert daraus.',
    estimated_minutes: 4,
    connector_id: 'google_drive',
  },
];

export function getWizard(key: string): WizardDef | undefined {
  return WIZARDS.find((w) => w.key === key);
}

export function wizardsByCategory(): Record<WizardCategory, WizardDef[]> {
  const out = {} as Record<WizardCategory, WizardDef[]>;
  (Object.keys(WIZARD_CATEGORIES) as WizardCategory[]).forEach((c) => (out[c] = []));
  WIZARDS.forEach((w) => out[w.category].push(w));
  return out;
}
