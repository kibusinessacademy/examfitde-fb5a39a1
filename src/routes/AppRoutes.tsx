import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

// Guards & Layouts
import MainLayout from '@/components/layout/MainLayout';
import AdminV4Layout from '@/components/layout/AdminV4Layout';
import SEOLayout from '@/components/layout/SEOLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AdminEmailGuard from '@/components/auth/AdminEmailGuard';
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
import ProgrammaticSEODispatcher from '@/pages/seo/ProgrammaticSEODispatcher';

// Legal Pages
const AGBPage = lazy(() => import('@/pages/seo/AGBPage'));
const FAQPage = lazy(() => import('@/pages/seo/FAQPage'));
const DatenschutzPage = lazy(() => import('@/pages/seo/DatenschutzPage'));
const ImpressumPage = lazy(() => import('@/pages/seo/ImpressumPage'));

// Admin V4 Module Pages
const CommandPage = lazy(() => import('@/pages/admin/v4/CommandPage'));
const StudioPage = lazy(() => import('@/pages/admin/v4/StudioPage'));
const QualityPage = lazy(() => import('@/pages/admin/v4/QualityPage'));
const OpsPage = lazy(() => import('@/pages/admin/v4/OpsPage'));
const BusinessPage = lazy(() => import('@/pages/admin/v4/BusinessPage'));
const GrowthPage = lazy(() => import('@/pages/admin/v4/GrowthPage'));
const ScalePage = lazy(() => import('@/pages/admin/v4/ScalePage'));
const PipelineMonitorPage = lazy(() => import('@/pages/admin/v4/PipelineMonitorPage'));
const PipelineE2ERunbookPage = lazy(() => import('@/pages/admin/v4/PipelineE2ERunbookPage'));
const WorkPipelinePage = lazy(() => import('@/pages/admin/v4/BerufsKIPipelinePage'));
const LoadControlPage = lazy(() => import('@/pages/admin/v4/LoadControlPage'));
const CRMPage = lazy(() => import('@/pages/admin/v4/CRMPage'));
const SupportPage = lazy(() => import('@/pages/admin/v4/SupportPage'));
const SystemHandbookPage = lazy(() => import('@/pages/admin/v4/SystemHandbookPage'));
const QueueManagerPage = lazy(() => import('@/pages/admin/QueueManagerPage'));
const SocialEnginePage = lazy(() => import('@/pages/admin/v4/SocialEnginePage'));
const AuditDashboardPage = lazy(() => import('@/pages/admin/v4/AuditDashboardPage'));
const WorkAdminPage = lazy(() => import('@/pages/admin/v4/BerufsKIPage'));
const WorkTemplatesPage = lazy(() => import('@/pages/admin/v4/BerufsKITemplatesPage'));
const WorkBundlesPage = lazy(() => import('@/pages/admin/v4/BerufsKIBundlesPage'));
const WorkLicensesPage = lazy(() => import('@/pages/admin/v4/BerufsKILicensesPage'));
const WorkCommercePage = lazy(() => import('@/pages/admin/v4/BerufsKICommercePage'));
const WorkAffiliateDashboard = lazy(() => import('@/pages/admin/v4/BerufsKIAffiliateDashboard'));
const ProductionWavesPage = lazy(() => import('@/pages/admin/v4/ProductionWavesPage'));
const ProductionWaveDetailPage = lazy(() => import('@/pages/admin/factory/ProductionWaveDetailPage'));
const ProductionWaveTriagePage = lazy(() => import('@/pages/admin/factory/ProductionWaveTriagePage'));
const FactoryExecutiveDashboard = lazy(() => import('@/pages/admin/factory/FactoryExecutiveDashboard'));
const QualificationDiscoveryPage = lazy(() => import('@/pages/admin/intake/QualificationDiscoveryPage'));
const CurriculumIntakePage = lazy(() => import('@/pages/admin/intake/CurriculumIntakePage'));

// Control Tower Pages (new SSOT Leitzentrale)
const AdminControlTowerPage = lazy(() => import('@/pages/admin/AdminControlTowerPage'));
const AdminOpsQueuePage = lazy(() => import('@/pages/admin/AdminOpsQueuePage'));
const AdminProviderHealthPage = lazy(() => import('@/pages/admin/AdminProviderHealthPage'));
const AdminPackageRiskPage = lazy(() => import('@/pages/admin/AdminPackageRiskPage'));
const AdminRevenuePage = lazy(() => import('@/pages/admin/AdminRevenuePage'));
const AdminExecutiveHomePage = lazy(() => import('@/pages/admin/AdminExecutiveHomePage'));
const CohortOverviewPage = lazy(() => import('@/pages/admin/b2b/CohortOverviewPage'));
const LearnerCompetencyPage = lazy(() => import('@/pages/admin/b2b/LearnerCompetencyPage'));
const OrgDashboardPage = lazy(() => import('@/pages/admin/b2b/OrgDashboardPage'));

// ExamFit@work public pages
const WorkHomePage = lazy(() => import('@/pages/work/WorkHomePage'));
const WorkSuccessPage = lazy(() => import('@/pages/work/WorkSuccessPage'));
const WorkBuyPage = lazy(() => import('@/pages/work/WorkBuyPage'));
const WorkBundleBuyPage = lazy(() => import('@/pages/work/WorkBundleBuyPage'));
const WorkCorporatePage = lazy(() => import('@/pages/work/WorkCorporatePage'));

// Content nested routes
const ContentLayout = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.ContentLayout })));
const ContentPagesList = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.ContentPagesList })));
const BlogPostsList = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.BlogPostsList })));
const AssetsManager = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.AssetsManager })));
const RedirectsManager = lazy(() => import('@/pages/admin/v4/ContentCRMSupportPages').then(m => ({ default: m.RedirectsManager })));
const ContentBlocksEditor = lazy(() => import('@/pages/admin/v4/ContentBlocksEditor'));
const MediaAltManager = lazy(() => import('@/pages/admin/v4/MediaAltManager'));

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
        
        {/* Shop Routes */}
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/purchase-success" element={<PurchaseSuccessPage />} />

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

          <Route path="/:slug" element={<ProgrammaticSEODispatcher />} />

          <Route path="/ihk-pruefungen" element={<IHKPruefungenPage />} />
          <Route path="/pruefungstraining-azubis" element={<PruefungstrainingAzubisPage />} />
          <Route path="/pruefungstraining-betriebe" element={<PruefungstrainingBetriebePage />} />
          <Route path="/pruefungstraining-institutionen" element={<PruefungstrainingInstitutionenPage />} />
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
          <Route path="/pruefungshandbuch" element={<HandbookLandingPage />} />
          <Route path="/wissen" element={<WissenPage />} />
          <Route path="/wissen/alle" element={<WissenAllePage />} />
          <Route path="/suche" element={<SearchPage />} />
          <Route path="/agb" element={<AGBPage />} />
          <Route path="/faq" element={<FAQPage />} />
          <Route path="/datenschutz" element={<DatenschutzPage />} />
          <Route path="/impressum" element={<ImpressumPage />} />
          <Route path="/wissen/:slug" element={<WissenArticlePage />} />
        </Route>
        
        {/* Main Layout Routes */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
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

        {/* ====== ADMIN (unified SSOT layout) ====== */}
        <Route path="/admin" element={<AdminV4Layout />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<AdminExecutiveHomePage />} />
          <Route path="control-tower" element={<AdminControlTowerPage />} />
          <Route path="command" element={<CommandPage />} />
          <Route path="studio/*" element={<StudioPage />} />
          <Route path="quality/*" element={<QualityPage />} />
          <Route path="ops/*" element={<OpsPage />} />
          <Route path="business/*" element={<BusinessPage />} />
          <Route path="growth/*" element={<GrowthPage />} />
          <Route path="scale/*" element={<ScalePage />} />
          <Route path="pipeline" element={<PipelineMonitorPage />} />
          <Route path="pipeline/e2e" element={<PipelineE2ERunbookPage />} />
          <Route path="load-control" element={<LoadControlPage />} />
          <Route path="production" element={<ProductionWavesPage />} />
          <Route path="production/executive" element={<FactoryExecutiveDashboard />} />
          <Route path="production/detail" element={<ProductionWaveDetailPage />} />
          <Route path="production/triage" element={<ProductionWaveTriagePage />} />
          {/* Content with nested routes */}
          <Route path="content" element={<ContentLayout />}>
            <Route index element={<ContentPagesList />} />
            <Route path="blog" element={<BlogPostsList />} />
            <Route path="blocks" element={<ContentBlocksEditor />} />
            <Route path="assets" element={<AssetsManager />} />
            <Route path="media" element={<MediaAltManager />} />
            <Route path="seo" element={<RedirectsManager />} />
          </Route>
          <Route path="crm/*" element={<CRMPage />} />
          <Route path="support/*" element={<SupportPage />} />
          <Route path="handbook" element={<SystemHandbookPage />} />
          <Route path="queue" element={<QueueManagerPage />} />
          <Route path="social" element={<SocialEnginePage />} />
          <Route path="audit" element={<AuditDashboardPage />} />
          <Route path="intake/qualification-discovery" element={<QualificationDiscoveryPage />} />

          {/* B2B Competency Views */}
          <Route path="b2b/org" element={<OrgDashboardPage />} />
          <Route path="b2b/cohort" element={<CohortOverviewPage />} />
          <Route path="b2b/learner" element={<LearnerCompetencyPage />} />

          {/* ExamFit@work Admin (email-gated) */}
          <Route element={<AdminEmailGuard />}>
            <Route path="work" element={<WorkAdminPage />} />
            <Route path="work/pipeline" element={<WorkPipelinePage />} />
            <Route path="work/templates" element={<WorkTemplatesPage />} />
            <Route path="work/bundles" element={<WorkBundlesPage />} />
            <Route path="work/licenses" element={<WorkLicensesPage />} />
            <Route path="work/commerce" element={<WorkCommercePage />} />
            <Route path="work/affiliates" element={<WorkAffiliateDashboard />} />
          </Route>
        </Route>

        {/* Legacy admin redirects */}
        <Route path="/admin/control-tower" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/dashboard" element={<Navigate to="/admin/command" replace />} />
        <Route path="/admin/courses" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/course-studio" element={<Navigate to="/admin/studio/new" replace />} />
        <Route path="/admin/course/:packageId" element={<Navigate to="/admin/studio" replace />} />
        <Route path="/admin/jobs" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/jobs/*" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/system/*" element={<Navigate to="/admin/ops" replace />} />
        <Route path="/admin/finance/*" element={<Navigate to="/admin/business" replace />} />
        <Route path="/admin/council/*" element={<Navigate to="/admin/quality" replace />} />
        <Route path="/admin-v2/*" element={<Navigate to="/admin/command" replace />} />
        {/* Legacy berufski admin → work admin */}
        <Route path="/admin/berufski" element={<Navigate to="/admin/work" replace />} />
        <Route path="/admin/berufski/*" element={<Navigate to="/admin/work" replace />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
