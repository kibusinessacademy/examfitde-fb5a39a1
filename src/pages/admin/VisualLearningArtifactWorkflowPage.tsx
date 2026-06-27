/**
 * VISUAL.LEARNING.OS — Admin Artifact Workflow Page (Cut 7).
 *
 * Admin-only Lifecycle UI: list, filter, transition, audit timeline.
 * - No client table reads — every call goes through the edge function.
 * - Status transitions emitted as explicit admin actions (no auto-mutation).
 * - Publish CTA only enabled when status === 'approved'.
 * - Draft / needs_review / approved are clearly marked as NOT learner-visible.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";

import {
  approveVisualLearningArtifact,
  archiveVisualLearningArtifact,
  getVisualLearningArtifactForAdmin,
  listVisualLearningArtifactsForAdmin,
  publishVisualLearningArtifact,
  submitVisualLearningArtifactForReview,
  type AdminArtifactDetail,
  type AdminArtifactEvent,
  type AdminArtifactRow,
} from "@/lib/visual-learning-os/persistence.functions";
import { reviewVisualLearningArtifact } from "@/lib/visual-learning-os/visual-artifact-review";
import { isAllowedVloTransition } from "@/lib/visual-learning-os/persistence-policy";
import { createAdminPreviewArtifact } from "@/lib/visual-learning-os/admin-preview";

import VisualArtifactPreview from "@/components/admin/visual-learning/VisualArtifactPreview";
import VisualArtifactReviewPanel from "@/components/admin/visual-learning/VisualArtifactReviewPanel";
import VisualArtifactRubricPanel from "@/components/admin/visual-learning/VisualArtifactRubricPanel";
import VisualArtifactSourceRefsPanel from "@/components/admin/visual-learning/VisualArtifactSourceRefsPanel";

type Status = AdminArtifactRow["status"];

const STATUS_LABEL: Record<Status, string> = {
  draft: "Entwurf · nicht learner-sichtbar",
  needs_review: "Review nötig · nicht learner-sichtbar",
  approved: "Freigegeben · noch nicht learner-sichtbar",
  published: "Veröffentlicht · learner-sichtbar",
  archived: "Archiviert · nicht learner-sichtbar",
};

export default function VisualLearningArtifactWorkflowPage() {
  const [rows, setRows] = useState<AdminArtifactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [filters, setFilters] = useState({
    curriculum_id: "",
    competence_id: "",
    lesson_id: "",
    blueprint_id: "",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminArtifactDetail | null>(null);
  const [events, setEvents] = useState<AdminArtifactEvent[]>([]);
  const [actionBusy, setActionBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listVisualLearningArtifactsForAdmin({
        status: statusFilter || undefined,
        curriculum_id: filters.curriculum_id || undefined,
        competence_id: filters.competence_id || undefined,
        lesson_id: filters.lesson_id || undefined,
        blueprint_id: filters.blueprint_id || undefined,
        limit: 200,
      });
      setRows(res.artifacts);
    } catch (e: any) {
      setError(e?.message ?? "unknown_error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setEvents([]);
    try {
      const res = await getVisualLearningArtifactForAdmin(id);
      setDetail(res.artifact);
      setEvents(res.events);
    } catch (e: any) {
      setError(e?.message ?? "unknown_error");
    }
  }, []);

  const currentStatus: Status | null = detail?.status ?? null;

  const reviewResultForApprove = useMemo(() => {
    if (!detail) return null;
    try {
      return reviewVisualLearningArtifact({
        artifact: detail.artifact_json,
        source_refs: detail.source_refs ?? [],
      });
    } catch {
      return null;
    }
  }, [detail]);

  async function act(fn: () => Promise<unknown>) {
    setActionBusy(true);
    setError(null);
    try {
      await fn();
      if (selectedId) await loadDetail(selectedId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "unknown_error");
    } finally {
      setActionBusy(false);
    }
  }

  const canSubmit = currentStatus ? isAllowedVloTransition(currentStatus, "needs_review") : false;
  const canApprove =
    currentStatus === "needs_review" &&
    !!reviewResultForApprove &&
    reviewResultForApprove.status === "approved" &&
    reviewResultForApprove.blockers.length === 0;
  const canPublish = currentStatus === "approved";
  const canArchive = currentStatus ? isAllowedVloTransition(currentStatus, "archived") : false;

  return (
    <main
      className="container mx-auto max-w-7xl space-y-6 p-6"
      data-testid="vlo-workflow-page"
    >
      <Helmet>
        <title>Visual Learning · Artifact Workflow</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <header>
        <h1 className="text-2xl font-semibold text-foreground">
          Visual Learning · Artifact Workflow
        </h1>
        <p className="text-sm text-muted-foreground">
          Lifecycle: draft → needs_review → approved → published → archived. Kein Auto-Publish.
        </p>
      </header>

      <section
        className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-4 md:grid-cols-5"
        aria-label="Filter"
        data-testid="vlo-workflow-filters"
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select
            className="rounded border bg-background px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Status | "")}
            data-testid="vlo-filter-status"
          >
            <option value="">Alle</option>
            <option value="draft">draft</option>
            <option value="needs_review">needs_review</option>
            <option value="approved">approved</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </label>
        {(["curriculum_id", "competence_id", "lesson_id", "blueprint_id"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {k}
            <input
              className="rounded border bg-background px-2 py-1 text-sm"
              value={filters[k]}
              onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value }))}
              data-testid={`vlo-filter-${k}`}
            />
          </label>
        ))}
      </section>

      {error ? (
        <div
          className="rounded border bg-muted p-2 text-xs text-foreground"
          data-testid="vlo-workflow-error"
        >
          {error}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div
          className="overflow-hidden rounded-lg border bg-background"
          data-testid="vlo-workflow-list"
        >
          <header className="flex items-center justify-between border-b p-3">
            <h2 className="text-sm font-semibold">Artifacts ({rows.length})</h2>
            <button
              className="rounded border bg-muted px-2 py-1 text-xs"
              onClick={refresh}
              disabled={loading}
              data-testid="vlo-workflow-refresh"
            >
              {loading ? "Lade…" : "Neu laden"}
            </button>
          </header>
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {rows.length === 0 ? (
              <li className="p-4 text-xs text-muted-foreground">Keine Einträge.</li>
            ) : (
              rows.map((r) => (
                <li
                  key={r.id}
                  className={`cursor-pointer p-3 text-sm hover:bg-muted/40 ${
                    selectedId === r.id ? "bg-muted/60" : ""
                  }`}
                  onClick={() => loadDetail(r.id)}
                  data-testid="vlo-workflow-row"
                  data-row-id={r.id}
                  data-row-status={r.status}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{r.title}</span>
                    <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono uppercase">
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {r.artifact_type} · {r.curriculum_id} / {r.competence_id}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="space-y-4">
          {!detail ? (
            <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
              Wähle ein Artefakt links aus.
            </div>
          ) : (
            <>
              <div
                className="rounded-lg border bg-background p-4"
                data-testid="vlo-workflow-detail"
                data-detail-status={detail.status}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{detail.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABEL[detail.status]}
                    </p>
                  </div>
                  <span className="rounded border bg-muted px-2 py-1 text-[11px] font-mono uppercase">
                    v{detail.version}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded border bg-card px-3 py-1 text-xs disabled:opacity-40"
                    disabled={!canSubmit || actionBusy}
                    onClick={() =>
                      act(() => submitVisualLearningArtifactForReview(detail.id))
                    }
                    data-testid="vlo-action-submit"
                  >
                    Zur Review einreichen
                  </button>
                  <button
                    className="rounded border bg-card px-3 py-1 text-xs disabled:opacity-40"
                    disabled={!canApprove || actionBusy}
                    onClick={() =>
                      act(() =>
                        approveVisualLearningArtifact(detail.id, reviewResultForApprove!),
                      )
                    }
                    data-testid="vlo-action-approve"
                  >
                    Freigeben
                  </button>
                  <button
                    className="rounded border bg-card px-3 py-1 text-xs disabled:opacity-40"
                    disabled={!canPublish || actionBusy}
                    onClick={() => act(() => publishVisualLearningArtifact(detail.id))}
                    data-testid="vlo-action-publish"
                  >
                    Veröffentlichen
                  </button>
                  <button
                    className="rounded border bg-card px-3 py-1 text-xs disabled:opacity-40"
                    disabled={!canArchive || actionBusy}
                    onClick={() => act(() => archiveVisualLearningArtifact(detail.id))}
                    data-testid="vlo-action-archive"
                  >
                    Archivieren
                  </button>
                </div>
              </div>

              {(() => {
                const pv = createAdminPreviewArtifact(detail.artifact_json);
                return pv.ok ? (
                  <VisualArtifactPreview source={pv.preview} sourceRefs={detail.source_refs} />
                ) : null;
              })()}
              {reviewResultForApprove ? (
                <VisualArtifactReviewPanel review={reviewResultForApprove} />
              ) : null}
              <VisualArtifactRubricPanel rubric={detail.artifact_json?.assessment_rubric} />
              <VisualArtifactSourceRefsPanel
                artifact={detail.artifact_json}
                sourceRefs={detail.source_refs}
              />

              <section
                className="rounded-lg border bg-background p-4"
                data-testid="vlo-workflow-events"
              >
                <h3 className="mb-2 text-sm font-semibold">Event Timeline</h3>
                {events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Keine Events.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded border bg-card p-2"
                        data-testid="vlo-workflow-event"
                        data-event-type={ev.event_type}
                      >
                        <span className="font-mono text-foreground">{ev.event_type}</span>
                        {ev.from_status || ev.to_status ? (
                          <span className="ml-2 font-mono text-muted-foreground">
                            {ev.from_status ?? "∅"} → {ev.to_status ?? "∅"}
                          </span>
                        ) : null}
                        <span className="ml-2 text-muted-foreground">
                          {new Date(ev.created_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
