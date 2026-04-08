import { useSearchParams, useNavigate } from 'react-router-dom';
import { useExamHeatmap, HeatmapCell } from '@/hooks/useExamHeatmap';
import { ArrowLeft, Loader2, Grid3X3, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const HEAT_COLORS = [
  'bg-muted text-muted-foreground',                                    // 0: no data
  'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',     // 1: weak
  'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300', // 2: developing
  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300', // 3: proficient
  'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',     // 4: mastered
];

const HEAT_LABELS = ['Keine Daten', 'Schwach', 'Aufbau', 'Gut', 'Stark'];
const HEAT_BORDERS = [
  'border-muted',
  'border-red-200 dark:border-red-800',
  'border-orange-200 dark:border-orange-800',
  'border-yellow-200 dark:border-yellow-800',
  'border-green-200 dark:border-green-800',
];

function HeatCell({ cell }: { cell: HeatmapCell }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            'rounded-xl p-3 border-2 transition-all cursor-default',
            HEAT_COLORS[cell.heat_level],
            HEAT_BORDERS[cell.heat_level],
          )}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold opacity-70">{cell.learning_field_code}</span>
              <span className="text-xs font-semibold">{cell.accuracy}%</span>
            </div>
            <p className="text-xs font-medium leading-tight line-clamp-2">{cell.learning_field_title}</p>
            <div className="mt-2 flex items-center gap-1.5">
              <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-current opacity-60 transition-all"
                  style={{ width: `${cell.accuracy}%` }}
                />
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          <p className="font-semibold">{cell.learning_field_title}</p>
          <p>{cell.total_answers} Fragen beantwortet</p>
          <p>{cell.correct_answers} richtig ({cell.accuracy}%)</p>
          <p>{cell.competency_count} Kompetenzen</p>
          <p className="font-medium mt-1">Status: {HEAT_LABELS[cell.heat_level]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {HEAT_LABELS.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={cn('w-3 h-3 rounded-sm border', HEAT_COLORS[i], HEAT_BORDERS[i])} />
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function ExamHeatmapPage() {
  const [searchParams] = useSearchParams();
  const curriculumId = searchParams.get('curriculum') || undefined;
  const navigate = useNavigate();
  const { data: cells, isLoading, error } = useExamHeatmap(curriculumId);

  const overallAccuracy = cells && cells.length > 0
    ? Math.round(cells.reduce((sum, c) => sum + c.correct_answers, 0) / Math.max(1, cells.reduce((sum, c) => sum + c.total_answers, 0)) * 100)
    : 0;
  const totalAnswered = cells?.reduce((s, c) => s + c.total_answers, 0) || 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <button onClick={() => navigate('/dashboard')} className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Prüfungs-Heatmap</span>
        </div>
        <div className="w-9" />
      </header>

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Lade Heatmap...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-sm text-destructive">Fehler beim Laden der Heatmap.</p>
          </div>
        )}

        {!isLoading && cells && (
          <>
            {/* Summary */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Deine Prüfungsreife</h2>
                  <p className="text-xs text-muted-foreground">{totalAnswered} Fragen beantwortet</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold text-foreground">{overallAccuracy}%</span>
                  <p className="text-xs text-muted-foreground">Gesamt</p>
                </div>
              </div>
              <Legend />
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-muted/50 border">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Jede Kachel zeigt ein Lernfeld. Je grüner, desto sicherer bist du. Tippe auf eine Kachel für Details.
              </p>
            </div>

            {/* Heatmap Grid */}
            {cells.length === 0 ? (
              <div className="text-center py-12">
                <Grid3X3 className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Noch keine Daten. Starte den Shuttle Mode!</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {cells.map(cell => (
                  <HeatCell key={cell.learning_field_id} cell={cell} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
