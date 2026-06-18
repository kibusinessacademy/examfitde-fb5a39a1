<!--
  PR Template — Architecture Invariants enforced.
  Read: mem://constraints/architecture-invariants-8-rules-v1
-->

## Summary
<!-- One sentence: what & why. -->

## Feature Justification (REQUIRED for new routes / tables / edge functions / registries)

Pick **at least one**. Without one of these, the feature must not be built (`FEATURE_REJECTED`).

```
FEATURE_JUSTIFICATION: <one of>
  EXTENDS_CAPABILITY        # erweitert bestehende Fähigkeit
  CLOSES_GAP                # schließt bekannte Lücke
  CONNECTS_MODULES          # verbindet ≥2 bestehende Module
  INCREASES_AUTOMATION      # erhöht Automatisierungsgrad
  IMPROVES_FLOW             # verbessert Nutzerfluss
reason: <one sentence>
```

If knowingly violating an invariant:
```
INVARIANT_OVERRIDE: <RULE_NAME>
reason: <why an exception is required>
```

## 8 Architecture Invariants — Checklist

- [ ] **1. DUPLICATION.GUARD** — Kein vorhandenes Modul / Route / ServerFn / SSOT / Registry erweitert das nicht? (sonst `EXTEND_EXISTING`)
- [ ] **2. NO.REGRESSION.GUARD** — Keine Features / Bridges / UX-Flows / Deep-Links entfernt oder verkürzt ohne Freigabe.
- [ ] **3. BRIDGE.REQUIRED** — Input · Output · Persona · Downstream · Deep-Link · Folgeprozess sind benannt.
- [ ] **4. GAP.CLOSURE.REQUIRED** — Welche Lücke schließt es? Welche neue erzeugt es? Welche angrenzenden Module betroffen?
- [ ] **5. UX.CONSISTENCY.GATE** — Gleiche Terminologie · Aktionen · CTAs · Farbsemantik · Navigation wie bestehende Surfaces.
- [ ] **6. E2E.WORKFLOW.REQUIRED** — Vollständige Kette: Erfassung → Verarbeitung → Bewertung → Aktion → Folgeaktion → Audit.
- [ ] **7. UX.GAP.SCAN** — „Was muss der Nutzer danach tun?" ist beantwortet — nicht „manuell suchen / woanders hingehen / neu eingeben".
- [ ] **8. REALITY.VERIFICATION.REQUIRED** — Reality-/E2E-Test über die volle Journey vorhanden (CORS-autoritativ).

## Changes
<!-- Bullet list of meaningful changes. -->

## Verification
<!-- Tests / scripts / screenshots / journey id. -->
