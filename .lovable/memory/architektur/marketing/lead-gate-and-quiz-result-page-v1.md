---
name: useLeadGate curriculum-specific resolve
description: Lead-Gate prüft quiz_attempts NUR für aufgelöste curriculum_id. Resolve-Chain curriculumId → packageId → productSlug. Kein globaler Quiz-Fallback. resolveReason in lead_gate_shown metadata.
type: feature
---

# useLeadGate Curriculum-Specific Resolve

## Regel
Lead-Gate prüft Recency **nur** für die curriculum_id, die zum aktuellen Produkt gehört. Kein globaler "irgendein Quiz"-Fallback.

## Resolve-Chain (in dieser Reihenfolge)
1. `curriculumId` direkt → reason `curriculum_direct`
2. `packageId` → `course_packages.curriculum_id` → reason `resolved_from_package`
3. `productSlug` → `products.id` → published `course_packages.curriculum_id` (latest) → reason `resolved_from_product_slug`

Wenn keiner zieht: `resolveReason='curriculum_resolve_failed'`, Modal **trotzdem** zeigen (Soft-Nudge), aber `hasRecentAttempt=false`.

## Tracking
`lead_gate_shown.metadata.reason` enthält den `resolveReason`. So messbar:
- wie oft Resolve scheitert (= Verkabelungsproblem)
- wie oft direkter Kauf ohne Diagnose (= echter Skip)

## Call-Sites
- `PersonaLandingPage` → `useLeadGate({ productSlug: slug })`
- `DynamicProductLandingPage` → `useLeadGate({ productSlug: slug })`

`LeadGateModal` akzeptiert jetzt `curriculumId` + `resolveReason` und propagiert beide ins `lead_gate_shown`-Event.
