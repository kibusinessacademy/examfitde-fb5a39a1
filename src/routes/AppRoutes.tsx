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
import AuthHomeRoute from '@/components/auth/AuthHomeRoute';
const CoursesPage = lazyRetry(() => import('@/pages/CoursesPage'));
const CourseDetailPage = lazyRetry(() => import('@/pages/CourseDetailPage'));
const LearnerDashboard = lazyRetry(() => import('@/pages/LearnerDashboard'));
const ExamTrainer = lazyRetry(() => import('@/pages/ExamTrainer'));
const Auth = lazyRetry(() => import('@/pages/Auth'));
const ResetPassword = lazyRetry(() => import('@/pages/auth/ResetPassword'));
const NotFound = lazyRetry(() => import('@/pages/NotFound'));
const InstallPage = lazyRetry(() => import('@/pages/InstallPage'));

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
const PreisePage = lazyRetry(() => import('@/pages/seo/PreisePage'));
const LernkurseListPage = lazyRetry(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.LernkurseListPage })));
const PruefungstrainerListPage = lazyRetry(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.PruefungstrainerListPage })));
const BundleListPage = lazyRetry(() => import('@/pages/seo/ProductListPage').then(m => ({ default: m.BundleListPage })));
const LernkursDetailPage = lazyRetry(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.LernkursDetailPage })));
const PruefungstrainerDetailPage = lazyRetry(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.PruefungstrainerDetailPage })));
const BundleDetailPage = lazyRetry(() => import('@/pages/seo/ProductDetailPage').then(m => ({ default: m.BundleDetailPage })));
const WissenPage = lazyRetry(() => import('@/pages/seo/WissenPage'));
const WitzPage = lazyRetry(() => import('@/pages/seo/WitzPage'));
const FrageDesTagsPage = lazyRetry(() => import('@/pages/seo/FrageDesTagsPage'));
const PruefungsfehlerPage = lazyRetry(() => import('@/pages/seo/PruefungsfehlerPage'));
const BestehensRechnerPage = lazyRetry(() => import('@/pages/seo/BestehensRechnerPage'));
const WissenArticlePage = lazyRetry(() => import('@/pages/seo/WissenArticlePage'));
const WissenAllePage = lazyRetry(() => import('@/pages/seo/WissenAllePage'));
const SearchPage = lazyRetry(() => import('@/pages/seo/SearchPage'));
const CertificationCategoryPage = lazyRetry(() => import('@/pages/seo/CertificationCategoryPage'));
const CertificationSEOPage = lazyRetry(() => import('@/pages/seo/CertificationSEOPage'));
const PruefungstrainingHub = lazyRetry(() => import('@/pages/seo/PruefungstrainingHub'));
const PruefungstrainingDetailPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingDetailPage'));
const KarrierePage = lazyRetry(() => import('@/pages/seo/KarrierePage'));
const BetriebeLandingPage = lazyRetry(() => import('@/pages/seo/BetriebeLandingPage'));
const WirtschaftsfachwirtPage = lazyRetry(() => import('@/pages/seo/WirtschaftsfachwirtPage'));
const PruefungstrainingStudiumPage = lazyRetry(() => import('@/pages/seo/PruefungstrainingStudiumPage'));
const FortbildungLandingPage = lazyRetry(() => import('@/pages/seo/FortbildungLandingPage'));
const ZertifizierungenLandingPage = lazyRetry(() => import('@/pages/seo/ZertifizierungenLandingPage'));
const ProductLandingPage = lazyRetry(() => import('@/pages/seo/ProductLandingPage'));
const DynamicProductLandingPage = lazyRetry(() => import('@/pages/landing/DynamicProductLandingPage'));
const PersonaLandingPage = lazyRetry(() => import('@/pages/landing/PersonaLandingPage'));
const PersonaLandingHubPage = lazyRetry(() => import('@/pages/landing/PersonaLandingHubPage'));
import ProgrammaticSEODispatcher from '@/pages/seo/ProgrammaticSEODispatcher';
const PruefungsreifeCheck = lazyRetry(() => import('@/components/marketing/PruefungsreifeCheck'));
const BlogIndexPage = lazyRetry(() => import('@/pages/seo/BlogIndexPage'));
const BlogArticlePage = lazyRetry(() => import('@/pages/seo/BlogArticlePage'));

// Legal Pages
const AGBPage = lazyRetry(() => import('@/pages/seo/AGBPage'));
const FAQPage = lazyRetry(() => import('@/pages/seo/FAQPage'));
const DatenschutzPage = lazyRetry(() => import('@/pages/seo/DatenschutzPage'));
const ImpressumPage = lazyRetry(() => import('@/pages/seo/ImpressumPage'));

// Admin V2 SSOT Pages
const AdminV2Layout = lazyRetry(() => import('@/components/admin/v2/AdminV2Layout'));
const LeitstellePage = lazyRetry(() => import('@/pages/admin/v2/LeitstellePage'));
const KursePage = lazyRetry(() => import('@/pages/admin/v2/KursePage'));
const QueuePage = lazyRetry(() => import('@/pages/admin/v2/QueuePage'));
const GrowthPage = lazyRetry(() => import('@/pages/admin/v2/GrowthPage'));
const TestAreaPage = lazyRetry(() => import('@/pages/admin/v2/TestAreaPage'));
const CourseWorkspace = lazyRetry(() => import('@/pages/admin/CourseWorkspace'));

// ExamFit@work public pages
const WorkHomePage = lazyRetry(() => import('@/pages/work/WorkHomePage'));
const WorkSuccessPage = lazyRetry(() => import('@/pages/work/WorkSuccessPage'));
const WorkBuyPage = lazyRetry(() => import('@/pages/work/WorkBuyPage'));
const WorkBundleBuyPage = lazyRetry(() => import('@/pages/work/WorkBundleBuyPage'));
const WorkCorporatePage = lazyRetry(() => import('@/pages/work/WorkCorporatePage'));

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
const CheckoutSuccessPage = lazyRetry(() => import('@/pages/checkout/CheckoutSuccessPage'));

// Handbook Pages
const HandbookPage = lazyRetry(() => import('@/pages/HandbookPage'));
const HandbookChapterPage = lazyRetry(() => import('@/pages/HandbookChapterPage'));
const HandbookLandingPage = lazyRetry(() => import('@/pages/seo/HandbookLandingPage'));

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
          <Route path="/" element={<AuthHomeRoute />} />
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

        {/* ====== ADMIN V2 (SSOT-only) ====== */}
        <Route path="/admin" element={<AdminV2Layout />}>
          <Route index element={<Navigate to="command" replace />} />
          <Route path="command" element={<LeitstellePage />} />
          <Route path="studio" element={<KursePage />} />
          <Route path="studio/:packageId" element={<CourseWorkspace />} />
          <Route path="queue" element={<QueuePage />} />
          <Route path="*" element={<Navigate to="/admin/command" replace />} />
        </Route>

        {/* All unknown paths → 404 (admin wildcard already catches /admin/*) */}
        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};

export default AppRoutes;
