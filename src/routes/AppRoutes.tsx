import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

/** Retry a dynamic import up to 3 times with a short delay (handles Vite HMR restarts). */
function lazyRetry<T extends { default: React.ComponentType<any> }>(
  factory: () => Promise<T>,
  retries = 3,
): React.LazyExoticComponent<T['default']> {
  return lazy(() => {
    const attempt = (remaining: number): Promise<T> =>
      factory().catch((err) => {
        if (remaining <= 0) throw err;
        return new Promise<T>((res) => setTimeout(() => res(attempt(remaining - 1)), 1000));
      });
    return attempt(retries);
  });
}

// Guards & Layouts
import MainLayout from '@/components/layout/MainLayout';
// AdminV4Layout removed — V2 SSOT-only
import SEOLayout from '@/components/layout/SEOLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import WorkGonePage from '@/components/work/WorkGonePage';
import { RouteNoindex } from '@/components/seo/RouteNoindex';
import { LegacyParamRedirect } from '@/components/seo/LegacyParamRedirect';

// Lazy Loaded Pages
import AuthHomeRoute from '@/components/auth/AuthHomeRoute';
const CoursesPage = lazyRetry(() => import('@/pages/CoursesPage'));
const CourseDetailPage = lazyRetry(() => import('@/pages/CourseDetailPage'));
const LearnerDashboard = lazyRetry(() => import('@/pages/LearnerDashboard'));
const ExamTrainer = lazyRetry(() => import('@/pages/ExamTrainer'));
const Auth = lazyRetry(() => import('@/pages/Auth'));
const ResetPassword = lazyRetry(() => import('@/pages/auth/ResetPassword'));
const NotFound = lazyRetry(() => import('@/pages/NotFound'));
const InstallPage = lazyRetry(() => import('@/pages/InstallPage'));
const RenewPage = lazyRetry(() => import('@/pages/org/RenewPage'));
const DiagPage = lazyRetry(() => import('@/pages/DiagPage'));
const HomePageV1Legacy = lazyRetry(() => import('@/pages/HomePage'));

// /app — Account/Verwaltungsbereich (separat von /dashboard Lern-Hub)
const AppLayout = lazyRetry(() => import('@/pages/app/AppLayout'));
const AppOverviewPage = lazyRetry(() => import('@/pages/app/AppOverviewPage'));
const AppStartPage = lazyRetry(() => import('@/pages/app/AppStartPage'));
const AppOralPage = lazyRetry(() => import('@/pages/app/AppOralPage'));
const AppLernpfadPage = lazyRetry(() => import('@/pages/app/AppLernpfadPage'));
const AppTutorPage = lazyRetry(() => import('@/pages/app/AppTutorPage'));
const AppKompetenzPage = lazyRetry(() => import('@/pages/app/AppKompetenzPage'));
const AppMiniCheckPage = lazyRetry(() => import('@/pages/app/AppMiniCheckPage'));
const AppExamTrainerPage = lazyRetry(() => import('@/pages/app/AppExamTrainerPage'));
const PruefungscheckPage = lazyRetry(() => import('@/pages/public/PruefungscheckPage'));
const AppCoursesPage = lazyRetry(() => import('@/pages/app/AppCoursesPage'));
const AppInvoicesPage = lazyRetry(() => import('@/pages/app/AppInvoicesPage'));
const AppDownloadsPage = lazyRetry(() => import('@/pages/app/AppDownloadsPage'));
const AppLicensesPage = lazyRetry(() => import('@/pages/app/AppLicensesPage'));
const AppProfilePage = lazyRetry(() => import('@/pages/app/AppProfilePage'));
const AppNotificationsPage = lazyRetry(() => import('@/pages/app/AppNotificationsPage'));
const AppGdprPage = lazyRetry(() => import('@/pages/app/AppGdprPage'));

// SEO Pages
const IHKPruefungenPage = lazyRetry(() => import('@/pages/seo/IHKPruefungenPage'));
const PruefungstrainingAzubisPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingAzubisPage'));
const PruefungstrainingBetriebePage = lazyRetry(() => import('@/pages/seo/PruefungstrainingBetriebePage'));
// PruefungstrainingInstitutionenPage → redirected to Berufsschulen
const PruefungstrainingAusbildungPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingAusbildungPage'));
const PruefungstrainingBerufsschulenPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingBerufsschulenPage'));
const PruefungstrainingWeiterbildungPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingWeiterbildungPage'));
const BerufePage = lazyRetry(() => import('@/pages/seo/BerufePage'));
const BerufDetailPage = lazyRetry(() => import('@/pages/seo/BerufDetailPage'));
const UnternehmenPage = lazyRetry(() => import('@/pages/seo/UnternehmenPage'));
const PartnerDashboardPage = lazyRetry(() => import('@/pages/partner/PartnerDashboardPage'));
const PreisePage = lazyRetry(() => import('@/pages/seo/PreisePage'));
const LegacyProductRedirect = lazyRetry(() => import('@/pages/seo/LegacyProductRedirect'));
const PaketListPage = lazyRetry(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.BundleListPage })));
const PaketDetailPage = lazyRetry(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.BundleDetailPage })));
const BundleToPaketRedirect = lazyRetry(() => import('@/pages/seo/BundleToPaketRedirect'));
const WissenPage = lazyRetry(() => import('@/pages/seo/WissenPage'));
const WitzPage = lazyRetry(() => import('@/pages/seo/WitzPage'));
const FrageDesTagsPage = lazyRetry(() => import('@/pages/seo/FrageDesTagsPage'));
const PruefungsfehlerPage = lazyRetry(() => import('@/pages/seo/PruefungsfehlerPage'));
const BestehensRechnerPage = lazyRetry(() => import('@/pages/seo/BestehensRechnerPage'));
const WissenArticlePage = lazyRetry(() => import('@/pages/seo/WissenArticlePage'));
const WissenAllePage = lazyRetry(() => import('@/pages/seo/WissenAllePage'));
const WissenBerufPage = lazyRetry(() => import('@/pages/wissen/WissenBerufPage'));
const WissenKompetenzPage = lazyRetry(() => import('@/pages/wissen/WissenKompetenzPage'));
const WissenPruefungPage = lazyRetry(() => import('@/pages/wissen/WissenPruefungPage'));
const SearchPage = lazyRetry(() => import('@/pages/seo/SearchPage'));
const CertificationCategoryPage = lazyRetry(() => import('@/pages/seo/CertificationCategoryPage'));
const CertificationSEOPage = lazyRetry(() => import('@/pages/seo/CertificationSEOPage'));
const PruefungSlugRedirect = lazyRetry(() => import('@/pages/seo/PruefungSlugRedirect'));
const PruefungstrainingHub = lazyRetry(() => import('@/pages/seo/PruefungstrainingHub'));
const PruefungstrainingDetailPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingDetailPage'));
const KarrierePage = lazyRetry(() => import('@/pages/seo/KarrierePage'));
const BetriebeLandingPage = lazyRetry(() => import('@/pages/seo/BetriebeLandingPage'));
const WirtschaftsfachwirtPage = lazyRetry(() => import('@/pages/seo/WirtschaftsfachwirtPage'));
const PruefungstrainingStudiumPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingStudiumPage'));
const FortbildungLandingPage = lazyRetry(() => import('@/pages/seo/FortbildungLandingPage'));
const ZertifizierungenLandingPage = lazyRetry(() => import('@/pages/seo/ZertifizierungenLandingPage'));
const ProductLandingPage = lazyRetry(() => import('@/pages/seo/ProductLandingPage'));
const ProductPage = lazyRetry(() => import('@/pages/product/ProductPage'));
const ProductPersonaPage = lazyRetry(() => import('@/pages/product/ProductPersonaPage'));
const DynamicProductLandingPage = lazyRetry(() => import('@/pages/landing/DynamicProductLandingPage'));
const PersonaLandingPage = lazyRetry(() => import('@/pages/landing/PersonaLandingPage'));
const PersonaLandingHubPage = lazyRetry(() => import('@/pages/landing/PersonaLandingHubPage'));
import ProgrammaticSEODispatcher from '@/pages/seo/ProgrammaticSEODispatcher';
const IntentLandingPage = lazyRetry(() => import('@/pages/seo/IntentLandingPage'));
const PillarLandingPage = lazyRetry(() => import('@/pages/seo/PillarLandingPage'));
const EnterpriseDemoPage = lazyRetry(() => import('@/pages/seo/EnterpriseDemoPage'));
const PruefungsreifeCheck = lazyRetry(() => import('@/components/pruefungsreife/PruefungsreifeCheckPage'));
const LeadQuizPage = lazyRetry(() => import('@/pages/quiz/LeadQuizPage'));
const LernplanPage = lazyRetry(() => import('@/pages/quiz/LernplanPage'));
const QuizResultPage = lazyRetry(() => import('@/pages/quiz/QuizResultPage'));
const BlogIndexPage = lazyRetry(() => import('@/pages/seo/BlogIndexPage'));
const BlogArticlePage = lazyRetry(() => import('@/pages/seo/BlogArticlePage'));
const PruefungsfragenPage = lazyRetry(() => import('@/pages/seo/PruefungsfragenPage'));
const MuendlichePruefungPage = lazyRetry(() => import('@/pages/seo/MuendlichePruefungPage'));
const ProbepruefungPage = lazyRetry(() => import('@/pages/seo/ProbepruefungPage'));
const LernplanPruefungPage = lazyRetry(() => import('@/pages/seo/LernplanPruefungPage'));
const NewsletterConfirmPage = lazyRetry(() => import('@/pages/NewsletterConfirmPage'));
const ThemenHubPage = lazyRetry(() => import('@/pages/seo/ThemenHubPage'));

// IHK + AEVO Pillar-Cluster Pages
const IHKPruefungsvorbereitungPage = lazyRetry(() => import('@/pages/seo/IHKPruefungsvorbereitungPage'));
const IHKPruefungsfragenPage = lazyRetry(() => import('@/pages/seo/IHKPruefungsfragenPage'));
const IHKFachgespraechPage = lazyRetry(() => import('@/pages/seo/IHKFachgespraechPage'));
const IHKProbepruefungPage = lazyRetry(() => import('@/pages/seo/IHKProbepruefungPage'));
const AEVOPruefungsvorbereitungPage = lazyRetry(() => import('@/pages/seo/AEVOPruefungsvorbereitungPage'));
const AEVOSchriftlichePage = lazyRetry(() => import('@/pages/seo/AEVOSchriftlichePage'));
const AEVOPraktischePage = lazyRetry(() => import('@/pages/seo/AEVOPraktischePage'));
const AEVOFachgespraechPage = lazyRetry(() => import('@/pages/seo/AEVOFachgespraechPage'));

// Bilanzbuchhalter Pillar-Cluster
const BilanzbuchhalterPruefungsvorbereitungPage = lazyRetry(() => import('@/pages/seo/BilanzbuchhalterPruefungsvorbereitungPage'));
const BilanzbuchhalterBuchhaltungPage = lazyRetry(() => import('@/pages/seo/BilanzbuchhalterBuchhaltungPage'));
const BilanzbuchhalterJahresabschlussPage = lazyRetry(() => import('@/pages/seo/BilanzbuchhalterJahresabschlussPage'));
const BilanzbuchhalterSteuernPage = lazyRetry(() => import('@/pages/seo/BilanzbuchhalterSteuernPage'));

// FIAE Pillar-Cluster
const FIAEPruefungsvorbereitungPage = lazyRetry(() => import('@/pages/seo/FIAEPruefungsvorbereitungPage'));
const FIAEAnwendungsentwicklungPage = lazyRetry(() => import('@/pages/seo/FIAEAnwendungsentwicklungPage'));
const FIAEWiSoPage = lazyRetry(() => import('@/pages/seo/FIAEWiSoPage'));
const FIAEProjektarbeitPage = lazyRetry(() => import('@/pages/seo/FIAEProjektarbeitPage'));

// Studium Pillar-Cluster Pages
const StudiumPruefungsvorbereitungPage = lazyRetry(() => import('@/pages/seo/StudiumPruefungsvorbereitungPage'));
const KlausurtrainingStudiumPage = lazyRetry(() => import('@/pages/seo/KlausurtrainingStudiumPage'));
const BWLKlausurPage = lazyRetry(() => import('@/pages/seo/BWLKlausurPage'));
const RechnungswesenStudiumPage = lazyRetry(() => import('@/pages/seo/RechnungswesenStudiumPage'));
const LernplanStudiumPage = lazyRetry(() => import('@/pages/seo/LernplanStudiumPage'));
const PruefungsangstStudiumPage = lazyRetry(() => import('@/pages/seo/PruefungsangstStudiumPage'));
const MuendlichePruefungStudiumPage = lazyRetry(() => import('@/pages/seo/MuendlichePruefungStudiumPage'));

// Scrum & PRINCE2 Pillar-Cluster Pages
const ScrumPrince2ZertifizierungPage = lazyRetry(() => import('@/pages/seo/ScrumPrince2ZertifizierungPage'));
const ScrumPSMVorbereitungPage = lazyRetry(() => import('@/pages/seo/ScrumPSMVorbereitungPage'));
const ScrumCSMTrainingPage = lazyRetry(() => import('@/pages/seo/ScrumCSMTrainingPage'));
const Prince2FoundationPage = lazyRetry(() => import('@/pages/seo/Prince2FoundationPage'));
const Prince2PractitionerPage = lazyRetry(() => import('@/pages/seo/Prince2PractitionerPage'));
const ScrumPrince2VergleichPage = lazyRetry(() => import('@/pages/seo/ScrumPrince2VergleichPage'));

// Legal Pages
const AGBPage = lazyRetry(() => import('@/pages/seo/AGBPage'));
const FAQPage = lazyRetry(() => import('@/pages/seo/FAQPage'));
const DatenschutzPage = lazyRetry(() => import('@/pages/seo/DatenschutzPage'));
const ImpressumPage = lazyRetry(() => import('@/pages/seo/ImpressumPage'));

// Admin V2 SSOT Pages
const AdminV2Layout = lazyRetry(() => import('@/components/admin/v2/AdminV2Layout'));
const LeitstellePage = lazyRetry(() => import('@/pages/admin/v2/LeitstellePage'));
const OrgEnterprisePage = lazyRetry(() => import('@/pages/org/OrgEnterprisePage'));
const KursePage = lazyRetry(() => import('@/pages/admin/v2/KursePage'));
const GrowthPage = lazyRetry(() => import('@/pages/admin/v2/GrowthPage'));
const GrowthIntelligencePage = lazyRetry(() => import('@/pages/admin/v2/GrowthIntelligencePage'));
const TestAreaPage = lazyRetry(() => import('@/pages/admin/v2/TestAreaPage'));
const CourseWorkspace = lazyRetry(() => import('@/pages/admin/CourseWorkspace'));
const SupportPage = lazyRetry(() => import('@/pages/admin/v2/SupportPage'));
const KPIPage = lazyRetry(() => import('@/pages/admin/v2/KPIPage'));
// Heal-Hub: konsolidiert Queue, BlockerOps und HealStrategy. Alle alten URLs
// (queue, ops/blocker-ops, ops/heal-settings, …) werden via <Navigate /> umgeleitet.
const PackageDiagnosticsPage = lazyRetry(() => import('@/pages/admin/v2/PackageDiagnosticsPage'));
const SecurityFindingsPage = lazyRetry(() => import('@/pages/admin/v2/SecurityFindingsPage'));
const IntegrityCheckRunbookPage = lazyRetry(() => import('@/pages/admin/v2/IntegrityCheckRunbookPage'));
const JobTimelinePage = lazyRetry(() => import('@/pages/admin/v2/JobTimelinePage'));
const StepDoneAuditPage = lazyRetry(() => import('@/pages/admin/v2/StepDoneAuditPage'));
const IntegrityReportDiffPage = lazyRetry(() => import('@/pages/admin/v2/IntegrityReportDiffPage'));
const StaleMarkerDiffPage = lazyRetry(() => import('@/pages/admin/v2/StaleMarkerDiffPage'));
const CockpitPage = lazyRetry(() => import('@/pages/admin/v2/CockpitPage'));
const AIAnalysisAuditPage = lazyRetry(() => import('@/pages/admin/v2/AIAnalysisAuditPage'));
const SEOTestPage = lazyRetry(() => import('@/pages/admin/v2/SEOTestPage'));
const HealCockpitPage = lazyRetry(() => import('@/pages/admin/v2/HealCockpitPage'));
const GateHistoryDashboardPage = lazyRetry(() => import('@/pages/admin/v2/GateHistoryDashboardPage'));
const MasteryEngineSimulatorPage = lazyRetry(() => import('@/pages/admin/v2/MasteryEngineSimulatorPage'));
const ForensicsPage = lazyRetry(() => import('@/pages/admin/v2/ForensicsPage'));
const SyntheticCohortPage = lazyRetry(() => import('@/pages/admin/v2/SyntheticCohortPage'));
const PublishBlockerCockpitPage = lazyRetry(() => import('@/pages/admin/v2/PublishBlockerCockpitPage'));
const ExportPreviewPage = lazyRetry(() => import('@/pages/admin/v2/ExportPreviewPage'));
const AuditReportsPage = lazyRetry(() => import('@/pages/admin/v2/AuditReportsPage'));
const AdminRolesPage = lazyRetry(() => import('@/pages/admin/v2/AdminRolesPage'));
const AdminH5PUploadPage = lazyRetry(() => import('@/pages/admin/v2/AdminH5PUploadPage'));
const AdminH5PSmokePage = lazyRetry(() => import('@/pages/admin/v2/AdminH5PSmokePage'));
const AdminLearningEventsPage = lazyRetry(() => import('@/pages/admin/v2/AdminLearningEventsPage'));
const AdminAccessMatrixPage = lazyRetry(() => import('@/pages/admin/v2/AdminAccessMatrixPage'));
const AdminPaidOrdersOpsPage = lazyRetry(() => import('@/pages/admin/v2/AdminPaidOrdersOpsPage'));
const AdminTrafficFunnelPage = lazyRetry(() => import('@/pages/admin/v2/AdminTrafficFunnelPage'));
const StripeObservatoryPage = lazyRetry(() => import('@/pages/admin/v2/StripeObservatoryPage'));
const RuntimeCommandCenterPage = lazyRetry(() => import('@/pages/admin/v2/RuntimeCommandCenterPage'));

// ExamFit@work public pages
const WorkHomePage = lazyRetry(() => import('@/pages/work/WorkHomePage'));
const WorkSuccessPage = lazyRetry(() => import('@/pages/work/WorkSuccessPage'));
const WorkBuyPage = lazyRetry(() => import('@/pages/work/WorkBuyPage'));
// WorkBundleBuyPage removed 2026-05-17 (A4 dead-code cleanup, no active funnel pointing to /work/bundles/:bundleId)
const WorkCorporatePage = lazyRetry(() => import('@/pages/work/WorkCorporatePage'));

// VibeOS Masterbrand Landingpage
const VibeOSLandingPage = lazyRetry(() => import('@/pages/VibeOSLandingPage'));
const BerufOSHub = lazyRetry(() => import('@/pages/BerufOSHub'));
const BerufOSModulePage = lazyRetry(() => import('@/pages/berufos/BerufOSModulePage'));

// Berufs-KI public pages (eigenständige Produktlinie)
const BerufsKIHubPage = lazyRetry(() => import('@/pages/berufs-ki/BerufsKIHubPage'));
const BerufsKIWorkbenchPage = lazyRetry(() => import('@/pages/berufs-ki/BerufsKIWorkbenchPage'));
const BerufsKIWorkflowsPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIWorkflowsPage'));
const BerufsKIQualityPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIQualityPage'));
const BerufsKIReviewPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIReviewPage'));
const BerufsKILearningPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKILearningPage'));
const BerufsKIGraphPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIGraphPage'));
const BerufsKIEvolutionPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIEvolutionPage'));
const BerufsKIAgentsPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIAgentsPage'));
const BerufsKIControlCenterPage = lazyRetry(() => import('@/pages/admin/v2/BerufsKIControlCenterPage'));
const ProfessionLicensesPage = lazyRetry(() => import('@/pages/admin/v2/ProfessionLicensesPage'));
const BerufsKIInboxPage = lazyRetry(() => import('@/pages/berufs-ki/BerufsKIInboxPage'));
const BerufsKIDocumentsPage = lazyRetry(() => import('@/pages/berufs-ki/BerufsKIDocumentsPage'));
const BerufsKIDocumentsReviewPage = lazyRetry(() => import('@/pages/berufs-ki/BerufsKIDocumentsReviewPage'));
const DocumentAgentTemplatesPage = lazyRetry(() => import('@/pages/admin/v2/DocumentAgentTemplatesPage'));


// Learner Pages
const LessonPlayer = lazyRetry(() => import('@/pages/LessonPlayer'));
const ExamSimulation = lazyRetry(() => import('@/pages/ExamSimulation'));
const ExamResultsPage = lazyRetry(() => import('@/pages/ExamResultsPage'));
const OralExamTrainer = lazyRetry(() => import('@/pages/OralExamTrainer'));

// Enhanced Learning Pages
const SpacedRepetitionSession = lazyRetry(() => import('@/pages/SpacedRepetitionSession'));
const ExamAnxietyManager = lazyRetry(() => import('@/pages/ExamAnxietyManager'));
const VARKLerntypTest = lazyRetry(() => import('@/pages/VARKLerntypTest'));
const DiagnosticTest = lazyRetry(() => import('@/pages/DiagnosticTest'));
const DrillSession = lazyRetry(() => import('@/pages/DrillSession'));
const ShuttleModePage = lazyRetry(() => import('@/pages/ShuttleMode'));
const DailyChallengePage = lazyRetry(() => import('@/pages/DailyChallenge'));
const ExamHeatmapPage = lazyRetry(() => import('@/pages/ExamHeatmap'));

// Shop Pages
const ShopPage = lazyRetry(() => import('@/pages/ShopPage'));
const PurchaseSuccessPage = lazyRetry(() => import('@/pages/PurchaseSuccessPage'));
const WelcomePage = lazyRetry(() => import('@/pages/checkout/WelcomePage'));
const AhaPage = lazyRetry(() => import('@/pages/checkout/AhaPage'));

// Handbook Pages
const HandbookPage = lazyRetry(() => import('@/pages/HandbookPage'));
const HandbookChapterPage = lazyRetry(() => import('@/pages/HandbookChapterPage'));
const HandbookLandingPage = lazyRetry(() => import('@/pages/seo/HandbookLandingPage'));

// Internal Tools (noindex)
const EventInspectorPage = lazyRetry(() => import('@/pages/tools/EventInspectorPage'));

// Governance — Architectural Continuity Guard
const ArchitecturePage = lazyRetry(() => import('@/pages/admin/governance/ArchitecturePage'));
const PlatformConsciencePage = lazyRetry(() => import('@/pages/admin/PlatformConsciencePage'));
const IndexNowDashboardPage = lazyRetry(() => import('@/pages/admin/IndexNowDashboardPage'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const AppRoutes = () => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RouteNoindex />
      <Routes>
        {/* Legacy 301 redirects (GSC 404/Soft-404 cleanup, P6 Crawl Governance) */}
        <Route path="/about" element={<Navigate to="/unternehmen" replace />} />
        <Route path="/kontakt" element={<Navigate to="/impressum" replace />} />
        <Route path="/registrieren" element={<Navigate to="/auth" replace />} />
        <Route path="/repair-courses" element={<Navigate to="/" replace />} />
        <Route path="/legal/refund" element={<Navigate to="/agb" replace />} />
        <Route path="/legal/impressum" element={<Navigate to="/impressum" replace />} />
        <Route path="/legal/agb" element={<Navigate to="/agb" replace />} />
        <Route path="/legal/datenschutz" element={<Navigate to="/datenschutz" replace />} />
        <Route path="/user/support" element={<Navigate to="/faq" replace />} />
        <Route path="/user/*" element={<Navigate to="/faq" replace />} />
        <Route path="/shop/products" element={<Navigate to="/shop" replace />} />
        <Route path="/products" element={<Navigate to="/paket" replace />} />
        <Route path="/product/:slug" element={<LegacyParamRedirect to="/paket" />} />
        <Route path="/category/:slug" element={<Navigate to="/wissen" replace />} />
        <Route path="/ausbildungsberufe" element={<Navigate to="/ausbildung" replace />} />
        <Route path="/apprenticeship-course-detail/:slug" element={<LegacyParamRedirect to="/ausbildung" />} />
        <Route path="/learning/path/:courseId" element={<Navigate to="/dashboard" replace />} />
        <Route path="/learning/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/payment-success" element={<Navigate to="/purchase-success" replace />} />
        <Route path="/sitemap" element={<Navigate to="/sitemap.xml" replace />} />

        {/* Public Routes */}
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/reset-password" element={<ResetPassword />} />
        <Route path="/installieren" element={<InstallPage />} />
        <Route path="/renew" element={<RenewPage />} />
        <Route path="/tools/event-inspector" element={<EventInspectorPage />} />
        <Route path="/diag" element={<DiagPage />} />
        <Route path="/quiz/:slug" element={<LeadQuizPage />} />
        <Route path="/lernplan/:slug" element={<LernplanPage />} />
        <Route path="/pruefungsreife-ergebnis/:attemptId" element={<QuizResultPage />} />
        
        {/* Purchase Success → Activation Cut 1a: /willkommen ist Primärziel */}
        <Route path="/purchase-success" element={<PurchaseSuccessPage />} />
        <Route path="/willkommen" element={<WelcomePage />} />
        <Route path="/willkommen/aha" element={<AhaPage />} />
        {/* Legacy /checkout/success → /willkommen (Query-Params bleiben durch Navigate=true erhalten) */}
        <Route
          path="/checkout/success"
          element={<Navigate to={`/willkommen${typeof window !== 'undefined' ? window.location.search : ''}`} replace />}
        />

        {/* Continuity of Belief — Landingpage → Produkt-Übergang (Phase 4) */}
        <Route path="/app/start" element={<AppStartPage />} />
        {/* Phase 5.2 — Diagnostische Fachgesprächs-Simulation */}
        <Route path="/app/oral" element={<AppOralPage />} />
        {/* Phase 5.3 — Risiko-orientierte Prüfungsstrategie */}
        <Route path="/app/lernpfad" element={<AppLernpfadPage />} />
        {/* Phase 5.4 — Tutor-Surface: Bewusstsein des Systems */}
        <Route path="/app/tutor" element={<AppTutorPage />} />
        {/* Phase 5.5 — Kompetenzseiten: diagnostische Räume, keine Lerninhaltseiten */}
        <Route path="/app/kompetenz/:competencyId" element={<AppKompetenzPage />} />
        <Route path="/app/kompetenz" element={<AppKompetenzPage />} />
        {/* Phase 5.6 — MiniChecks: diagnostische Prüfungsimpulse */}
        <Route path="/app/minicheck/:competencyId" element={<AppMiniCheckPage />} />
        <Route path="/app/minicheck" element={<AppMiniCheckPage />} />
        {/* Phase 5.7 — Exam-Trainer: simulierte Prüfungssituation */}
        <Route path="/app/exam-trainer" element={<AppExamTrainerPage />} />
        {/* Phase 5.9 — Öffentliche diagnostische Erstbewertung (Prüfungscheck) */}
        <Route path="/pruefungscheck" element={<PruefungscheckPage />} />
        <Route path="/pruefungscheck/:slug" element={<PruefungscheckPage />} />



        {/* ExamFit@work Public Routes */}
        <Route path="/work" element={<WorkHomePage />} />
        <Route path="/partner" element={<PartnerDashboardPage />} />
        <Route path="/work/success" element={<WorkSuccessPage />} />
        <Route path="/work/buy/:productId" element={<WorkBuyPage />} />
        {/* /work/bundles/:bundleId entfernt 2026-05-17 (A4 dead-code, WorkBundleBuyPage gelöscht) */}
        <Route path="/work/corporate" element={<WorkCorporatePage />} />

        {/* BerufOS Masterbrand Hub — Legacy /berufos/* bleibt als Alias erreichbar.
            Hardcut 2026-05-25: Module sind primär unter /<slug> erreichbar. */}
        <Route path="/berufos" element={<Navigate to="/" replace />} />
        <Route path="/berufos/:slug" element={<BerufOSModulePage />} />
        <Route path="/vibeos" element={<Navigate to="/" replace />} />
        <Route path="/platform" element={<Navigate to="/" replace />} />

        {/* BerufOS Module unter Root (kanonische URLs) */}
        <Route path="/agents" element={<BerufOSModulePage slug="agents" />} />
        <Route path="/documents" element={<BerufOSModulePage slug="documents" />} />
        <Route path="/workflows" element={<BerufOSModulePage slug="workflows" />} />
        <Route path="/skills" element={<BerufOSModulePage slug="skills" />} />
        <Route path="/career" element={<BerufOSModulePage slug="career" />} />
        <Route path="/recruit" element={<BerufOSModulePage slug="recruit" />} />
        <Route path="/industries" element={<BerufOSModulePage slug="industries" />} />
        <Route path="/governance" element={<BerufOSModulePage slug="governance" />} />

        {/* /examfit = ExamFit LearningOS Marketing-Homepage (vorher /) */}
        <Route path="/examfit" element={<HomePageV1Legacy />} />

        {/* Berufs-KI — eigenständige Produktlinie */}
        <Route path="/berufs-ki" element={<BerufsKIHubPage />} />
        <Route path="/berufs-ki/app" element={<BerufsKIWorkbenchPage />} />
        <Route path="/prompts" element={<BerufsKIWorkbenchPage />} />
        <Route path="/berufs-ki/inbox" element={<BerufsKIInboxPage />} />
        <Route path="/berufs-ki/dokumente" element={<BerufsKIDocumentsPage />} />
        <Route path="/berufs-ki/dokumente/review" element={<BerufsKIDocumentsReviewPage />} />


        {/* Legacy /berufski/* → 410 Gone */}
        <Route path="/berufski/*" element={<WorkGonePage />} />
        <Route path="/berufski" element={<WorkGonePage />} />


        {/* Enterprise Demo Landing */}
        <Route path="/enterprise-demo" element={<EnterpriseDemoPage />} />

        {/* Enterprise Customer Console (IT-Leiter) */}
        <Route path="/org" element={<Navigate to="/org/enterprise" replace />} />
        <Route path="/org/enterprise" element={<OrgEnterprisePage />} />

        {/* SEO Routes */}
        <Route element={<SEOLayout />}>
          <Route path="/pruefungstraining" element={<PruefungstrainingHub />} />
          <Route path="/pruefungstraining/fachwirt/wirtschaftsfachwirt" element={<WirtschaftsfachwirtPage />} />
          {/* Persona-Routing pro Produkt — drei Einstiegspfade, ein Produkt (SSOT). */}
          <Route path="/pruefungstraining/:slug/azubi" element={<ProductPersonaPage />} />
          <Route path="/pruefungstraining/:slug/betrieb" element={<ProductPersonaPage />} />
          <Route path="/pruefungstraining/:slug/institution" element={<ProductPersonaPage />} />
          <Route path="/pruefungstraining/:category/:slug" element={<PruefungstrainingDetailPage />} />
          {/* SSOT-driven product page — replaces legacy detail page */}
          <Route path="/pruefungstraining/:slug" element={<ProductPage />} />

          <Route path="/ausbildung" element={<CertificationCategoryPage />} />
          <Route path="/ausbildung/:slug" element={<CertificationSEOPage />} />
          <Route path="/fachwirt" element={<CertificationCategoryPage />} />
          <Route path="/fachwirt/:slug" element={<CertificationSEOPage />} />
          <Route path="/meister" element={<CertificationCategoryPage />} />
          <Route path="/meister/:slug" element={<CertificationSEOPage />} />
          <Route path="/sachkunde" element={<CertificationCategoryPage />} />
          <Route path="/sachkunde/:slug" element={<CertificationSEOPage />} />
          <Route path="/projektmanagement" element={<CertificationCategoryPage />} />
          <Route path="/projektmanagement/:slug" element={<CertificationSEOPage />} />
          {/* Cockpit-/Marketing-URL: leitet auf kanonische Kategorie-URL weiter */}
          <Route path="/pruefung/:slug" element={<PruefungSlugRedirect />} />
          <Route path="/produkt/:slug" element={<ProductLandingPage />} />
          <Route path="/landing/:landingType/:slug" element={<DynamicProductLandingPage />} />

          {/* Persona-specific SEO landing pages */}
          <Route path="/pruefungstraining-azubis/:slug" element={<PersonaLandingPage personaType="azubi" />} />
          <Route path="/pruefungstraining-sachkunde/:slug" element={<PersonaLandingPage personaType="sachkunde" />} />
          <Route path="/pruefungstraining-fachwirt/:slug" element={<PersonaLandingPage personaType="fachwirt" />} />
          <Route path="/pruefungstraining-studium/:slug" element={<PersonaLandingPage personaType="studium" />} />

          {/* SEO Intent-Pages: /kurse/<curriculum>/<intent>/<competency> — must be BEFORE /:slug catch-all */}
          <Route path="/kurse/:curriculumSlug/:intentSlug/:competencySlug" element={<IntentLandingPage />} />
          {/* SEO Pillar-Pages: /kurse/<curriculum> — Hub für alle Spokes eines Curriculums */}
          <Route path="/kurse/:curriculumSlug" element={<PillarLandingPage />} />

          <Route path="/:slug" element={<ProgrammaticSEODispatcher />} />

          <Route path="/pruefungsfragen" element={<PruefungsfragenPage />} />
          <Route path="/muendliche-pruefung" element={<MuendlichePruefungPage />} />
          <Route path="/probepruefung" element={<ProbepruefungPage />} />
          <Route path="/lernplan-pruefung" element={<LernplanPruefungPage />} />

          {/* Topic-Map Hub */}
          <Route path="/themen" element={<ThemenHubPage />} />

          {/* IHK Pillar-Cluster */}
          <Route path="/ihk-pruefungsvorbereitung" element={<IHKPruefungsvorbereitungPage />} />
          <Route path="/ihk-pruefungsfragen" element={<IHKPruefungsfragenPage />} />
          <Route path="/ihk-fachgespraech" element={<IHKFachgespraechPage />} />
          <Route path="/ihk-probepruefung" element={<IHKProbepruefungPage />} />

          {/* AEVO Pillar-Cluster */}
          <Route path="/aevo-pruefungsvorbereitung" element={<AEVOPruefungsvorbereitungPage />} />
          <Route path="/aevo-schriftliche-pruefung" element={<AEVOSchriftlichePage />} />
          <Route path="/aevo-praktische-pruefung" element={<AEVOPraktischePage />} />
          <Route path="/aevo-fachgespraech" element={<AEVOFachgespraechPage />} />

          {/* Bilanzbuchhalter Pillar-Cluster */}
          <Route path="/bilanzbuchhalter-pruefungsvorbereitung" element={<BilanzbuchhalterPruefungsvorbereitungPage />} />
          <Route path="/bilanzbuchhalter-buchhaltung" element={<BilanzbuchhalterBuchhaltungPage />} />
          <Route path="/bilanzbuchhalter-jahresabschluss" element={<BilanzbuchhalterJahresabschlussPage />} />
          <Route path="/bilanzbuchhalter-steuern" element={<BilanzbuchhalterSteuernPage />} />

          {/* Fachinformatiker AE Pillar-Cluster */}
          <Route path="/fachinformatiker-ae-pruefungsvorbereitung" element={<FIAEPruefungsvorbereitungPage />} />
          <Route path="/fiae-anwendungsentwicklung" element={<FIAEAnwendungsentwicklungPage />} />
          <Route path="/fiae-wiso" element={<FIAEWiSoPage />} />
          <Route path="/fiae-projektarbeit" element={<FIAEProjektarbeitPage />} />

          {/* Studium Pillar-Cluster */}
          <Route path="/studium-pruefungsvorbereitung" element={<StudiumPruefungsvorbereitungPage />} />
          <Route path="/klausurtraining-studium" element={<KlausurtrainingStudiumPage />} />
          <Route path="/bwl-klausur" element={<BWLKlausurPage />} />
          <Route path="/rechnungswesen-studium" element={<RechnungswesenStudiumPage />} />
          <Route path="/lernplan-studium" element={<LernplanStudiumPage />} />
          <Route path="/pruefungsangst-studium" element={<PruefungsangstStudiumPage />} />
          <Route path="/muendliche-pruefung-studium" element={<MuendlichePruefungStudiumPage />} />

          {/* Scrum & PRINCE2 Pillar-Cluster */}
          <Route path="/scrum-prince2-zertifizierung" element={<ScrumPrince2ZertifizierungPage />} />
          <Route path="/scrum-psm-vorbereitung" element={<ScrumPSMVorbereitungPage />} />
          <Route path="/scrum-csm-training" element={<ScrumCSMTrainingPage />} />
          <Route path="/prince2-foundation" element={<Prince2FoundationPage />} />
          <Route path="/prince2-practitioner" element={<Prince2PractitionerPage />} />
          <Route path="/scrum-prince2-vergleich" element={<ScrumPrince2VergleichPage />} />

          <Route path="/ihk-pruefungen" element={<IHKPruefungenPage />} />
          <Route path="/pruefungstraining-azubis" element={<PruefungstrainingAzubisPage />} />
          <Route path="/pruefungstraining-betriebe" element={<PruefungstrainingBetriebePage />} />
          <Route path="/pruefungstraining-institutionen" element={<Navigate to="/pruefungstraining-berufsschulen" replace />} />
          <Route path="/pruefungstraining-ausbildung" element={<PruefungstrainingAusbildungPage />} />
          <Route path="/pruefungstraining-berufsschulen" element={<PruefungstrainingBerufsschulenPage />} />
          <Route path="/pruefungstraining-weiterbildung" element={<PruefungstrainingWeiterbildungPage />} />
          <Route path="/pruefungstraining-studium" element={<PruefungstrainingStudiumPage />} />
          <Route path="/pruefungstraining-fortbildung" element={<FortbildungLandingPage />} />
          <Route path="/pruefungstraining-zertifizierungen" element={<ZertifizierungenLandingPage />} />
          <Route path="/witz/:humorId" element={<WitzPage />} />
          <Route path="/frage-des-tages" element={<FrageDesTagsPage />} />
          <Route path="/frage-des-tages/:slug" element={<FrageDesTagsPage />} />
          <Route path="/pruefungsfehler/:slug" element={<PruefungsfehlerPage />} />
          <Route path="/bestehens-rechner" element={<BestehensRechnerPage />} />
          <Route path="/bestehe-ich-die-ihk-pruefung" element={<BestehensRechnerPage />} />
          <Route path="/ihk-pruefungen/:slug" element={<BerufDetailPage />} />
          <Route path="/berufe" element={<BerufePage />} />
          <Route path="/berufe/:slug" element={<BerufDetailPage />} />
          {/* Komplettpaket-Strategie: Ein Beruf = ein kanonisches Paket unter /paket/:slug.
              Legacy /lernkurse, /pruefungstrainer, /bundle redirecten auf /paket. */}
          <Route path="/lernkurse" element={<LegacyProductRedirect />} />
          <Route path="/lernkurse/:slug" element={<LegacyProductRedirect />} />
          <Route path="/pruefungstrainer" element={<LegacyProductRedirect />} />
          <Route path="/pruefungstrainer/:slug" element={<LegacyProductRedirect />} />
          <Route path="/bundle" element={<BundleToPaketRedirect />} />
          <Route path="/bundle/:slug" element={<BundleToPaketRedirect />} />
          <Route path="/paket" element={<PaketListPage />} />
          <Route path="/paket/:slug" element={<PaketDetailPage />} />
          <Route path="/unternehmen" element={<UnternehmenPage />} />
          <Route path="/preise" element={<PreisePage />} />
          <Route path="/karriere" element={<KarrierePage />} />
          <Route path="/betriebe" element={<BetriebeLandingPage />} />
          <Route path="/fortbildung" element={<FortbildungLandingPage />} />
          <Route path="/zertifizierungen" element={<ZertifizierungenLandingPage />} />
          <Route path="/pruefungshandbuch" element={<HandbookLandingPage />} />
          <Route path="/wissen" element={<WissenPage />} />
          <Route path="/wissen/alle" element={<WissenAllePage />} />
          <Route path="/suche" element={<SearchPage />} />
          <Route path="/agb" element={<AGBPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/datenschutz" element={<DatenschutzPage />} />
          <Route path="/impressum" element={<ImpressumPage />} />
          <Route path="/wissen/beruf/:key" element={<WissenBerufPage />} />
          <Route path="/wissen/kompetenz/:key" element={<WissenKompetenzPage />} />
          <Route path="/wissen/pruefung/:key" element={<WissenPruefungPage />} />
          <Route path="/wissen/:slug" element={<WissenArticlePage />} />
          <Route path="/blog" element={<BlogIndexPage />} />
          <Route path="/blog/:slug" element={<BlogArticlePage />} />
        </Route>
        
        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<AuthHomeRoute />} />
          <Route path="/v1" element={<HomePageV1Legacy />} />
          {/* Funnel: Prüfungsreife-Check needs the marketing header for brand-trust + back-nav (Audit P0) */}
          <Route path="/pruefungsreife-check" element={<PruefungsreifeCheck />} />
          <Route path="/shop" element={<ShopPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/course/:slug" element={<CourseDetailPage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<LearnerDashboard />} />
            <Route path="/exam-trainer" element={<ExamTrainer />} />
            
            
            <Route path="/oral-exam" element={<OralExamTrainer />} />
            <Route path="/exam-simulation" element={<ExamSimulation />} />
            <Route path="/exam-simulation/:sessionId" element={<ExamSimulation />} />
            <Route path="/exam-results/:sessionId" element={<ExamResultsPage />} />
            <Route path="/lesson/:lessonId" element={<LessonPlayer />} />
            <Route path="/spaced-repetition" element={<SpacedRepetitionSession />} />
            <Route path="/drill" element={<DrillSession />} />
            <Route path="/shuttle" element={<ShuttleModePage />} />
            <Route path="/daily-challenge" element={<DailyChallengePage />} />
            <Route path="/heatmap" element={<ExamHeatmapPage />} />
            <Route path="/exam-anxiety" element={<ExamAnxietyManager />} />
            <Route path="/vark-test" element={<VARKLerntypTest />} />
            <Route path="/diagnostic/:curriculumId" element={<DiagnosticTest />} />
            <Route path="/handbuch" element={<HandbookPage />} />
            <Route path="/handbuch/:chapterKey" element={<HandbookChapterPage />} />
          </Route>
        </Route>

        {/* ====== /app — Account-Bereich (Protected) ====== */}
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<AppOverviewPage />} />
            <Route path="meine-kurse" element={<AppCoursesPage />} />
            <Route path="rechnungen" element={<AppInvoicesPage />} />
            <Route path="downloads" element={<AppDownloadsPage />} />
            <Route path="lizenzen" element={<AppLicensesPage />} />
            <Route path="profil" element={<AppProfilePage />} />
            <Route path="benachrichtigungen" element={<AppNotificationsPage />} />
            <Route path="dsgvo" element={<AppGdprPage />} />
          </Route>
        </Route>

        {/* ====== ADMIN V2 (SSOT-only) ====== */}
        <Route path="/admin" element={<AdminV2Layout />}>
          <Route index element={<Navigate to="cockpit" replace />} />
          <Route path="cockpit" element={<CockpitPage />} />
          <Route path="command" element={<LeitstellePage />} />
          <Route path="studio" element={<KursePage />} />
          <Route path="studio/:packageId" element={<CourseWorkspace />} />
          {/* === Heal Cockpit (SSOT — konsolidiert Queue + BlockerOps + HealStrategy) === */}
          <Route path="heal" element={<HealCockpitPage />} />
          <Route path="heal/gate-history" element={<GateHistoryDashboardPage />} />
          <Route path="mastery/simulator" element={<MasteryEngineSimulatorPage />} />
          <Route path="forensics" element={<ForensicsPage />} />
          <Route path="synthetic-cohort" element={<SyntheticCohortPage />} />
          <Route path="ops/publish-blockers" element={<PublishBlockerCockpitPage />} />
          <Route path="factory/export-preview/:packageId" element={<ExportPreviewPage />} />
          <Route path="governance/architecture" element={<ArchitecturePage />} />
          {/* Legacy redirects — alle alten Heal-/Queue-Hubs landen im Heal Cockpit */}
          <Route path="queue" element={<Navigate to="/admin/heal?queue_tab=live" replace />} />
          <Route path="heal-cockpit" element={<Navigate to="/admin/heal?queue_tab=heal" replace />} />
          <Route path="heal-cockpit/package/:packageId" element={<PackageDiagnosticsPage />} />
          <Route path="queue/stagnation" element={<Navigate to="/admin/heal?queue_tab=stagnation" replace />} />
          <Route path="audit/bypass" element={<Navigate to="/admin/heal?queue_tab=audit" replace />} />
          <Route path="ops/stuck-steps" element={<Navigate to="/admin/heal?queue_tab=stuck" replace />} />
          <Route path="ops/repair-queue" element={<Navigate to="/admin/heal?queue_tab=repair" replace />} />
          <Route path="ops/retry-loops" element={<Navigate to="/admin/heal?queue_tab=retry" replace />} />
          <Route path="ops/blocker-ops" element={<Navigate to="/admin/heal" replace />} />
          <Route path="ops/heal-settings" element={<Navigate to="/admin/heal" replace />} />

          <Route path="jobs/timeline" element={<JobTimelinePage />} />
          <Route path="growth" element={<GrowthPage />} />
          <Route path="growth-intelligence" element={<GrowthIntelligencePage />} />
          <Route path="support" element={<SupportPage />} />
          <Route path="kpi" element={<KPIPage />} />
          <Route path="security/findings" element={<SecurityFindingsPage />} />
          <Route path="runbook/integrity-check" element={<IntegrityCheckRunbookPage />} />
          <Route path="ops/step-done-audit" element={<StepDoneAuditPage />} />
          <Route path="ops/integrity-diff" element={<IntegrityReportDiffPage />} />
          <Route path="ops/integrity-diff/:packageId" element={<IntegrityReportDiffPage />} />
          <Route path="ops/stale-marker-diff" element={<StaleMarkerDiffPage />} />
          <Route path="test" element={<TestAreaPage />} />
          <Route path="ops/ai-analysis-audit" element={<AIAnalysisAuditPage />} />
          <Route path="ops/seo-test" element={<SEOTestPage />} />
          <Route path="ops/audit-reports" element={<AuditReportsPage />} />
          <Route path="ops/roles" element={<AdminRolesPage />} />
          <Route path="ops/h5p" element={<AdminH5PUploadPage />} />
          <Route path="ops/h5p-smoke" element={<AdminH5PSmokePage />} />
          <Route path="ops/events" element={<AdminLearningEventsPage />} />
          <Route path="ops/access" element={<AdminAccessMatrixPage />} />
          <Route path="ops/orders" element={<AdminPaidOrdersOpsPage />} />
          <Route path="ops/funnel" element={<AdminTrafficFunnelPage />} />
          <Route path="observatory" element={<StripeObservatoryPage />} />
          <Route path="runtime" element={<RuntimeCommandCenterPage />} />
          <Route path="platform-conscience" element={<PlatformConsciencePage />} />
          <Route path="seo/indexnow" element={<IndexNowDashboardPage />} />
          <Route path="berufs-ki/workflows" element={<BerufsKIWorkflowsPage />} />
          <Route path="berufs-ki/quality" element={<BerufsKIQualityPage />} />
          <Route path="berufs-ki/review" element={<BerufsKIReviewPage />} />
          <Route path="berufs-ki/learning" element={<BerufsKILearningPage />} />
          <Route path="berufs-ki/graph" element={<BerufsKIGraphPage />} />
          <Route path="berufs-ki/evolution" element={<BerufsKIEvolutionPage />} />
          <Route path="berufs-ki/agents" element={<BerufsKIAgentsPage />} />
          <Route path="berufs-ki/control-center" element={<BerufsKIControlCenterPage />} />
          <Route path="governance/profession-licenses" element={<ProfessionLicensesPage />} />
          <Route path="berufs-ki/documents" element={<DocumentAgentTemplatesPage />} />
          <Route path="*" element={<Navigate to="/admin/command" replace />} />

        </Route>

        {/* All unknown paths → 404 (admin wildcard already catches /admin/*) */}
        {/* 404 */}
        <Route path="/newsletter/confirm" element={<NewsletterConfirmPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
