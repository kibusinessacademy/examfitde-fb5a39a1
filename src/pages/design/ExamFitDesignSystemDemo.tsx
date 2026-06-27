/**
 * EXAMFIT.DESIGN.SYSTEM.OS.1 — Admin Demo / Wave 1
 *
 * Read-only Showcase aller Primitives + Status-Tokens + Bereichs-Gradients.
 * Admin-only: wird in AppRoutes hinter dem bestehenden Admin-Guard registriert.
 * Keine echte Lernlogik, kein LIF-Bypass, keine Curriculum-Calls.
 */
import {
  HeroSurface,
  ImageCard,
  FloatingChip,
  GlassPanel,
  ProgressMeter,
  HERO_AREAS,
  CHIP_VARIANTS,
  type HeroArea,
  type FloatingChipVariant,
} from '@/components/examfit-ds';
import { BookOpen, Trophy, Bot, Mic, Star, Clock } from 'lucide-react';

const HERO_LABEL: Record<HeroArea, string> = {
  learn: 'Lernkurs',
  exam: 'Prüfung',
  tutor: 'KI-Tutor',
  oral: 'Mündliche Prüfung',
  shop: 'Shop',
};

const STATUS_TOKENS = [
  { key: 'done', label: 'Done', cls: 'bg-status-done-subtle text-status-done-fg border-status-done-border' },
  { key: 'current', label: 'Current', cls: 'bg-status-current-subtle text-status-current-fg border-status-current-border' },
  { key: 'recommendation', label: 'Empfehlung', cls: 'bg-status-recommendation-subtle text-status-recommendation-fg border-status-recommendation-border' },
  { key: 'error', label: 'Fehler', cls: 'bg-status-error-subtle text-status-error-fg border-status-error-border' },
  { key: 'locked', label: 'Paywall', cls: 'bg-status-locked-subtle text-status-locked-fg border-status-locked-border' },
] as const;

export default function ExamFitDesignSystemDemo() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10" data-testid="examfit-ds-demo">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
          EXAMFIT.DESIGN.SYSTEM.OS.1 · Wave 1
        </p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-semibold text-text-primary">
          Foundation Tokens & Primitives
        </h1>
        <p className="mt-2 text-sm text-text-secondary max-w-2xl">
          Admin-Review-Surface. Ruhig, prüfungsnah, keine Neon-Töne. Alle Bausteine sind
          token-driven; keine Hex-Werte, kein automatisches Auto-Publish in Learner-Flows.
        </p>
      </header>

      {/* Status-Tokens */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Status-Tokens</h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_TOKENS.map((t) => (
            <span
              key={t.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${t.cls}`}
              data-testid={`ds-status-${t.key}`}
            >
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* Hero-Verläufe */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Bereichs-Gradients (Hero)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HERO_AREAS.map((area) => (
            <HeroSurface key={area} area={area} radius="card-lg">
              <p className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">
                {area}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-text-primary">{HERO_LABEL[area]}</h3>
              <p className="mt-1 text-sm text-text-secondary">
                Schritt 2 von 5 · Verstehen
              </p>
              <div className="mt-4">
                <ProgressMeter shape="bar" current={2} total={5} showPercent />
              </div>
            </HeroSurface>
          ))}
        </div>
      </section>

      {/* Image-Cards */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Image-Cards</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ImageCard
            eyebrow="Lernkurs"
            title="Grundlagen Immobilienmarketing"
            description="15 Minuten · Verstehen"
            actionLabel="Weiterlernen"
            fallbackArea="learn"
            onClick={() => {}}
            topRight={
              <>
                <FloatingChip variant="course" icon={<BookOpen className="h-3 w-3" />}>Kurs</FloatingChip>
                <FloatingChip variant="time" icon={<Clock className="h-3 w-3" />}>15 Min</FloatingChip>
              </>
            }
          />
          <ImageCard
            eyebrow="Prüfung"
            title="Abschlussprüfung Teil 1"
            description="82 % Score · letzte Simulation"
            actionLabel="Simulation starten"
            fallbackArea="exam"
            onClick={() => {}}
            topRight={<FloatingChip variant="exam" icon={<Trophy className="h-3 w-3" />}>Prüfung</FloatingChip>}
          />
          <ImageCard
            eyebrow="KI-Tutor"
            title="Frage stellen"
            description="Mit Quellen aus deinem Curriculum"
            actionLabel="Tutor öffnen"
            fallbackArea="tutor"
            onClick={() => {}}
            topRight={<FloatingChip variant="tutor" icon={<Bot className="h-3 w-3" />}>Tutor</FloatingChip>}
          />
        </div>
      </section>

      {/* Floating Chips */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-text-primary">Floating Chips</h2>
        <div className="flex flex-wrap gap-2">
          {CHIP_VARIANTS.map((v) => (
            <FloatingChip
              key={v}
              variant={v as FloatingChipVariant}
              icon={
                v === 'oral' ? <Mic className="h-3 w-3" /> :
                v === 'fav' ? <Star className="h-3 w-3" /> :
                v === 'tutor' ? <Bot className="h-3 w-3" /> :
                v === 'exam' ? <Trophy className="h-3 w-3" /> :
                v === 'time' ? <Clock className="h-3 w-3" /> : undefined
              }
            >
              {v}
            </FloatingChip>
          ))}
        </div>
      </section>

      {/* Glass + Progress */}
      <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GlassPanel radius="card-lg" className="p-5">
          <p className="text-[11px] uppercase tracking-wide text-text-tertiary font-medium">Glass Panel</p>
          <h3 className="mt-1 text-base font-semibold text-text-primary">Hinweis</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Frost-Container ohne `backdrop-filter` (render-safe). Opt-in nur in Browser-Kontexten.
          </p>
        </GlassPanel>
        <div className="flex flex-col gap-4 rounded-card-lg border border-border bg-card p-5 shadow-card">
          <ProgressMeter shape="bar" current={3} total={5} showPercent label="Lektion 3 von 5" />
          <ProgressMeter shape="dots" current={3} total={5} />
          <div className="flex items-center gap-4">
            <ProgressMeter shape="ring" current={64} total={100} showPercent />
            <span className="text-sm text-text-secondary">Ring-Variante</span>
          </div>
        </div>
      </section>
    </main>
  );
}
