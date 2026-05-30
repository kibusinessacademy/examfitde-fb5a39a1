---
name: Commercialization Tracks 30d
 description: Four prioritized market-activation tracks for next 30 days: Enterprise Trust, Demo OS, Workflow Marketplace, Enterprise Sales Assets. Architecture frozen.
 type: feature
---

# Commercialization Tracks — Next 30 Days (2026-05-30)

## Context

Agent-OS Architecture is frozen (mem://constraints/architecture-freeze-agent-os-v1). All engineering capacity redirects to market activation and enterprise capability.

---

## Track A — Enterprise Trust

**Goal:** Remove procurement blockers for ExamFit and BerufOS enterprise deals.

**Deliverables:**
- DSGVO Center (/enterprise/dsgvo)
- EU-AI-Act Center (/enterprise/ai-act)
- Vendor Registry (internal admin view)
- Data Flow Map (diagram + documentation)
- TOMs (technisch-organisatorische Maßnahmen)
- Auftragsverarbeitungsverträge (AVV templates)
- AI Transparency Reports
- Security Whitepaper (PDF + /enterprise/security)

**Why:** Many enterprise deals fail on compliance checklists. Being "GDPR-compliant" is not enough — being *demonstrably* compliant with documented TOMs, AVVs, and AI Act Article 14 transparency closes deals.

**Estimated Impact:** High (unblocks €10k+ ACV deals)

---

## Track B — Demo Operating System

**Goal:** Any prospect can experience product value without a sales call.

**Deliverables:**
- Guided Demo (/demo — existing, extend with CTA-to-value)
- Self-Service Demo (/demo/sandbox — sample data, no auth required)
- ROI-Rechner (/roi-rechner — time saved × cost per hour × exam failure rate)
- Sandbox Environment (pre-loaded with FISI/Industriekaufmann sample data)
- Beispiel-Daten (5 realistic learner profiles with progress states)

**Why:** Self-service demo is the #1 conversion lever for B2B SaaS. Every additional sales-call-avoided demo increases top-of-funnel conversion by 15-30%.

**Estimated Impact:** Very High (direct conversion lever)

---

## Track C — Workflow Marketplace

**Goal:** Make BerufOS valuable as a workflow platform, not just a learning tool.

**Deliverables:**
- Marketplace UI (/marketplace) for reusable workflows
- Template categories:
  - Ausbildungspläne (training plans)
  - Prüfungsvorbereitung (exam prep flows)
  - HR-Interviews (interview preparation)
  - Verwaltungsvorgänge (administrative processes)
  - Fördermittelprozesse (funding applications)
- Workflow detail page with "Use Template" CTA
- My Workflows page for instantiated workflows

**Why:** Workflow marketplace creates platform lock-in and expands addressable market beyond individual learners to organizational buyers.

**Estimated Impact:** Medium-High (platform Moat, B2B upsell)

---

## Track D — Enterprise Sales Assets

**Goal:** Equip sales team with battle-tested collateral.

**Deliverables per product (ExamFit, BerufOS, Berufs-KI, VerwaltungsOS):
- One-Pager (1-page PDF, problem/solution/outcome)
- Security Sheet (/enterprise/security — technical controls, certifications, incident response)
- Compliance Sheet (DSGVO, EU-AI-Act, BSI-Grundschutz mapping)
- ROI Sheet (calculator + case study + payback period)
- FAQ (20 most common procurement questions)
- Procurement Pack (standard MSA, AVV, SLA, pricing sheet)

**Why:** Enterprise sales cycles are 3-6 months. Every missing asset adds 2-4 weeks of back-and-forth. Complete procurement packs shorten cycles by 30-40%.

**Estimated Impact:** High (sales velocity)

---

## Prioritization

| Track | Impact | Effort | Sequence |
|---|---|---|---|
| B — Demo OS | Very High | Medium | 1st (direct conversion) |
| D — Sales Assets | High | Low | 2nd (enables sales now) |
| A — Enterprise Trust | High | High | 3rd (unblocks deals) |
| C — Workflow Marketplace | Medium-High | High | 4th (platform play) |

## Anti-Drift

- No new architecture, tables, or runtime systems for these tracks
- Re-use existing: course_packages (templates), job_queue (workflow execution), berufs_ki_agent_runs (demo runs), products/checkout (ROI calc)
- Every feature must point to a live product surface, not a conceptual page
- No "coming soon" — ship complete slices or don't ship