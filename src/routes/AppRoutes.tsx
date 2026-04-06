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

// Lazy Loaded Pages
const HomePage = lazy(() => import('@/pages/HomePage'));
const CoursesPage = lazy(() => import('@/pages/CoursesPage'));
const CourseDetailPage = lazy(() => import('@/pages/CourseDetailPage'));
const LearnerDashboard = lazy(() => import('@/pages/LearnerDashboard'));
const ExamTrainer = lazy(() => import('@/pages/ExamTrainer'));
const Auth = lazy(() => import('@/pages/Auth'));
const ResetPassword = lazy(() => import('@/pages/auth/ResetPassword'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const InstallPage = lazy(() => import('@/pages/InstallPage'));

// SEO Pages
const IHKPruefungenPage = lazy(() => import('@/pages/seo/IHKPruefungenPage'));
const PruefungstrainingAzubisPage = lazy(() => import('@/pages/seo/PruefungstrainingAzubisPage'));
const PruefungstrainingBetriebePage = lazy(() => import('@/pages/seo/PruefungstrainingBetriebePage'));
const PruefungstrainingInstitutionenPage = lazy(() => import('@/pages/seo/PruefungstrainingInstitutionenPage'));
const BerufePage = lazy(() => import('@/pages/seo/BerufePage'));
const BerufDetailPage = lazy(() => import('@/pages/seo/BerufDetailPage'));
const UnternehmenPage = lazy(() => import('@/pages/seo/UnternehmenPage'));
const PreisePage = lazy(() => import('@/pages/seo/PreisePage'));
const LernkurseListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.LernkurseListPage })));
const PruefungstrainerListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.PruefungstrainerListPage })));
const BundleListPage = lazy(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.BundleListPage })));
const LernkursDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.LernkursDetailPage })));
const PruefungstrainerDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.PruefungstrainerDetailPage })));
const BundleDetailPage = lazy(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.BundleDetailPage })));
const WissenPage = lazy(() => import('@/pages/seo/WissenPage'));
const WissenArticlePage = lazy(() => import('@/pages/seo/WissenArticlePage'));
const WissenAllePage = lazy(() => import('@/pages/seo/WissenAllePage'));
const SearchPage = lazy(() => import('@/pages/seo/SearchPage'));
const CertificationCategoryPage = lazy(() => import('@/pages/seo/CertificationCategoryPage'));
const CertificationSEOPage = lazy(() => import('@/pages/seo/CertificationSEOPage'));
const PruefungstrainingHub = lazy(() => import('@/pages/seo/PruefungstrainingHub'));
const PruefungstrainingDetailPage = lazy(() => import('@/pages/seo/PruefungstrainingDetailPage'));
const KarrierePage = lazy(() => import('@/pages/seo/KarrierePage'));
const BetriebeLandingPage = lazy(() => import('@/pages/seo/BetriebeLandingPage'));
const WirtschaftsfachwirtPage = lazy(() => import('@/pages/seo/WirtschaftsfachwirtPage'));
const PruefungstrainingStudiumPage = lazy(() => import('@/pages/seo/PruefungstrainingStudiumPage'));
const FortbildungLandingPage = lazy(() => import('@/pages/seo/FortbildungLandingPage'));
const ZertifizierungenLandingPage = lazy(() => import('@/pages/seo/ZertifizierungenLandingPage'));
const ProductLandingPage = lazy(() => import('@/pages/seo/ProductLandingPage'));
const DynamicProductLandingPage = lazy(() => import('@/pages/landing/DynamicProductLandingPage'));
const PersonaLandingPage = lazy(() => import('@/pages/landing/PersonaLandingPage'));
const PersonaLandingHubPage = lazy(() => import('@/pages/landing/PersonaLandingHubPage'));
import ProgrammaticSEODispatcher from '@/pages/seo/ProgrammaticSEODispatcher';
const PruefungsreifeCheck = lazy(() => import('@/components/marketing/PruefungsreifeCheck'));
const BlogIndexPage = lazy(() => import('@/pages/seo/BlogIndexPage'));
const BlogArticlePage = lazy(() => import('@/pages/seo/BlogArticlePage'));

// Legal Pages
const AGBPage = lazy(() => import('@/pages/seo/AGBPage'));
const FAQPage = lazy(() => import('@/pages/seo/FAQPage'));
const DatenschutzPage = lazy(() => import('@/pages/seo/DatenschutzPage'));
const ImpressumPage = lazy(() => import('@/pages/seo/ImpressumPage'));

// Admin V2 SSOT Pages
const AdminV2Layout = lazy(() => import('@/components/admin/v2/AdminV2Layout'));
const LeitstellePage = lazy(() => import('@/pages/admin/v2/LeitstellePage'));
const KursePage = lazy(() => import('@/pages/admin/v2/KursePage'));
const QueuePage = lazy(() => import('@/pages/admin/v2/QueuePage'));
const MarketingPage = lazy(() => import('@/pages/admin/v2/MarketingPage'));
const CompliancePage = lazy(() => import('@/pages/admin/v2/CompliancePage'));
const StandaloneLicensesPage = lazy(() => import('@/pages/admin/v2/StandaloneLicensesPage'));
const ContentQualityPage = lazy(() => import('@/pages/admin/v2/ContentQualityPage'));
const AdminDeactivatedPage = lazy(() => import('@/components/admin/v2/AdminDeactivatedPage'));
const AdminLearnerPreviewPage = lazy(() => import('@/pages/admin/AdminLearnerPreviewPage'));
const AdminTestAreaPage = lazy(() => import('@/pages/admin/AdminTestAreaPage'));
const AdminGrowthCockpitPage = lazy(() => import('@/pages/admin/AdminGrowthCockpitPage'));
const GrowthDashboardPage = lazy(() => import('@/pages/admin/GrowthDashboardPage'));
const CourseWorkspace = lazy(() => import('@/pages/admin/CourseWorkspace'));
const TrackOpsPage = lazy(() => import('@/pages/admin/TrackOpsPage'));
const RegulatoryPage = lazy(() => import('@/pages/admin/v2/RegulatoryPage'));

// ExamFit@work public pages
const WorkHomePage = lazy(() => import('@/pages/work/WorkHomePage'));
const WorkSuccessPage = lazy(() => import('@/pages/work/WorkSuccessPage'));
const WorkBuyPage = lazy(() => import('@/pages/work/WorkBuyPage'));
const WorkBundleBuyPage = lazy(() => import('@/pages/work/WorkBundleBuyPage'));
const WorkCorporatePage = lazy(() => import('@/pages/work/WorkCorporatePage'));

// Learner Pages
const LessonPlayer = lazy(() => import('@/pages/LessonPlayer'));
const ExamSimulation = lazy(() => import('@/pages/ExamSimulation'));
const ExamResultsPage = lazy(() => import('@/pages/ExamResultsPage'));
const OralExamTrainer = lazy(() => import('@/pages/OralExamTrainer'));

// Enhanced Learning Pages
const SpacedRepetitionSession = lazy(() => import('@/pages/SpacedRepetitionSession'));
const ExamAnxietyManager = lazy(() => import('@/pages/ExamAnxietyManager'));
const VARKLerntypTest = lazy(() => import('@/pages/VARKLerntypTest'));
const DiagnosticTest = lazy(() => import('@/pages/DiagnosticTest'));
const DrillSession = lazy(() => import('@/pages/DrillSession'));

// Shop Pages
const ShopPage = lazy(() => import('@/pages/ShopPage'));
const PurchaseSuccessPage = lazy(() => import('@/pages/PurchaseSuccessPage'));
const CheckoutSuccessPage = lazy(() => import('@/pages/checkout/CheckoutSuccessPage'));

// Handbook Pages
const HandbookPage = lazy(() => import('@/pages/HandbookPage'));
const HandbookChapterPage = lazy(() => import('@/pages/HandbookChapterPage'));
const HandbookLandingPage = lazy(() => import('@/pages/seo/HandbookLandingPage'));

const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const AppRoutes = () => {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/reset-password" element={<ResetPassword />} />
        <Route path="/installieren" element={<InstallPage />} />
        <Route path="/pruefungsreife-check" element={<PruefungsreifeCheck />} />
        
        {/* Purchase Success (standalone) */}
        <Route path="/purchase-success" element={<PurchaseSuccessPage />} />
        <Route path="/checkout/success" element={<CheckoutSuccessPage />} />

        {/* ExamFit@work Public Routes */}
        <Route path="/work" element={<WorkHomePage />} />
        <Route path="/work/success" element={<WorkSuccessPage />} />
        <Route path="/work/buy/:productId" element={<WorkBuyPage />} />
        <Route path="/work/bundles/:bundleId" element={<WorkBundleBuyPage />} />
        <Route path="/work/corporate" element={<WorkCorporatePage />} />

        {/* Legacy /berufski/* → 410 Gone */}
        <Route path="/berufski/*" element={<WorkGonePage />} />
        <Route path="/berufski" element={<WorkGonePage />} />

        {/* SEO Routes */}
        <Route element={<SEOLayout />}>
          <Route path="/pruefungstraining" element={<PruefungstrainingHub />} />
          <Route path="/pruefungstraining/:slugOrCategory" element={<PruefungstrainingDetailPage />} />
          <Route path="/pruefungstraining/fachwirt/wirtschaftsfachwirt" element={<WirtschaftsfachwirtPage />} />
          <Route path="/pruefungstraining/:category/:slug" element={<PruefungstrainingDetailPage />} />

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
          <Route path="/produkt/:slug" element={<ProductLandingPage />} />
          <Route path="/landing/:landingType/:slug" element={<DynamicProductLandingPage />} />

          {/* Persona-specific SEO landing pages */}
          <Route path="/pruefungstraining-azubis/:slug" element={<PersonaLandingPage personaType="azubi" />} />
          <Route path="/pruefungstraining-sachkunde/:slug" element={<PersonaLandingPage personaType="sachkunde" />} />
          <Route path="/pruefungstraining-fachwirt/:slug" element={<PersonaLandingPage personaType="fachwirt" />} />
          <Route path="/pruefungstraining-studium/:slug" element={<PersonaLandingPage personaType="studium" />} />

          <Route path="/:slug" element={<ProgrammaticSEODispatcher />} />

          <Route path="/ihk-pruefungen" element={<IHKPruefungenPage />} />
          <Route path="/pruefungstraining-azubis" element={<PruefungstrainingAzubisPage />} />
          <Route path="/pruefungstraining-betriebe" element={<PruefungstrainingBetriebePage />} />
          <Route path="/pruefungstraining-institutionen" element={<PruefungstrainingInstitutionenPage />} />
          <Route path="/pruefungstraining-studium" element={<PruefungstrainingStudiumPage />} />
          <Route path="/ihk-pruefungen/:slug" element={<BerufDetailPage />} />
          <Route path="/berufe" element={<BerufePage />} />
          <Route path="/berufe/:slug" element={<BerufDetailPage />} />
          <Route path="/lernkurse" element={<LernkurseListPage />} />
          <Route path="/lernkurse/:slug" element={<LernkursDetailPage />} />
          <Route path="/pruefungstrainer" element={<PruefungstrainerListPage />} />
          <Route path="/pruefungstrainer/:slug" element={<PruefungstrainerDetailPage />} />
          <Route path="/bundle" element={<BundleListPage />} />
          <Route path="/bundle/:slug" element={<BundleDetailPage />} />
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
          <Route path="/wissen/:slug" element={<WissenArticlePage />} />
          <Route path="/blog" element={<BlogIndexPage />} />
          <Route path="/blog/:slug" element={<BlogArticlePage />} />
        </Route>
        
        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
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
            <Route path="/exam-anxiety" element={<ExamAnxietyManager />} />
            <Route path="/vark-test" element={<VARKLerntypTest />} />
            <Route path="/diagnostic/:curriculumId" element={<DiagnosticTest />} />
            <Route path="/handbuch" element={<HandbookPage />} />
            <Route path="/handbuch/:chapterKey" element={<HandbookChapterPage />} />
          </Route>
        </Route>

        {/* ====== ADMIN V2 (SSOT-only) ====== */}
        <Route path="/admin" element={<AdminV2Layout />}>
          <Route index element={<Navigate to="studio" replace />} />
          <Route path="command" element={<LeitstellePage />} />
          <Route path="studio" element={<KursePage />} />
          <Route path="studio/:packageId" element={<CourseWorkspace />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="marketing" element={<MarketingPage />} />
          <Route path="compliance" element={<CompliancePage />} />
          <Route path="licenses" element={<StandaloneLicensesPage />} />
          <Route path="learner-preview" element={<AdminLearnerPreviewPage />} />
          <Route path="growth" element={<AdminGrowthCockpitPage />} />
          <Route path="growth-engine" element={<GrowthDashboardPage />} />
          <Route path="testbereich" element={<AdminTestAreaPage />} />
          <Route path="track-ops" element={<TrackOpsPage />} />
          <Route path="content-quality" element={<ContentQualityPage />} />
          <Route path="regulatory" element={<RegulatoryPage />} />
          <Route path="*" element={<AdminDeactivatedPage />} />
        </Route>

        {/* Legacy admin redirects → canonical V2 paths */}
        <Route path="/admin/dashboard" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/home" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/control-tower" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/leitstelle" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/courses" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/course-studio" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/course/:packageId" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/jobs" element={<Navigate to="/admin/queue" replace />} />
        <Route path="/admin/jobs/*" element={<Navigate to="/admin/queue" replace />} />
        <Route path="/admin/ops/queue" element={<Navigate to="/admin/queue" replace />} />
        <Route path="/admin/ops/queue/*" element={<Navigate to="/admin/queue" replace />} />
        <Route path="/admin/system/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/finance/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/council/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/business/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/revenue" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/revenue/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/content/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/crm/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/support/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/quality/*" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/packages/risk" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/packages/risk/*" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin-v2/*" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/berufski" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/berufski/*" element={<Navigate to="/admin/studio" replace />} />
        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
