# Memory: architektur/integration/lti-foundation-v1
Updated: 2026-03-29

## LTI Foundation — Architektur-Überblick

### Datenmodell

| Tabelle | Zweck | FK-Beziehungen |
|---|---|---|
| `lti_platform_registrations` | LMS/Plattform-Registrierungen (issuer, client_id, JWKS) | → organizations |
| `lti_deployments` | Deployment-Instanzen pro Plattform | → lti_platform_registrations, → organizations |
| `lti_resource_mappings` | Resource-Link → Examfit-Produkt Zuordnung | → lti_deployments, → products |
| `lti_launch_sessions` | Aktive Launch-Sessions mit Claims | → lti_deployments, → learner_identities |
| `lti_grade_passback_queue` | Grade-Rückgabe-Queue an LMS | → lti_launch_sessions |

### Sicherheit

- RLS auf allen Tabellen aktiviert
- Nur `service_role` hat Schreib-/Vollzugriff
- `authenticated` kann nur eigene Launch-Sessions lesen (via learner_identity_id)
- Keine `anon`-Zugriffsrechte
- RPCs sind SECURITY DEFINER mit `REVOKE FROM PUBLIC`
- Externe Subject-IDs werden nur als SHA-256 Hash gespeichert

### RPCs

| Funktion | Zweck | Zugriff |
|---|---|---|
| `resolve_lti_registration` | Plattform + Deployment auflösen | service_role |
| `resolve_lti_resource_mapping` | Resource-Link → Produkt-Mapping | service_role |
| `ensure_lti_learner_identity` | Learner-Identity finden/erstellen | service_role |

### Edge Functions

| Function | Zweck | Status |
|---|---|---|
| `lti-login-init` | OIDC Third-Party Login Initiation | ✅ Foundation |
| `lti-launch` | Launch-Endpoint mit Claims-Parsing, Session-Erstellung | ✅ Foundation |
| `lti-grade-passback` | Queue-basierte Grade-Rückgabe | ✅ Foundation |

### Produktintegration

- Resource Mappings referenzieren `products.id` direkt
- Kein Legacy-Entitlement-Pfad
- Zugriffslogik: Deployment-Zuordnung = Zugriffsberechtigung
- `can_access_product()` bleibt zentrale Prüflogik für direkte User-Zugriffe

### Job Registry

- `process_lti_grade_passback` in allen 3 Schichten registriert:
  - DB: `ops_job_type_registry`
  - Edge: `_shared/job-map.ts` (nächster Schritt)
  - Client: `src/lib/jobs/job-registry.ts` ✅

### TODO für Produktionsreife

1. **JWT-Kryptografie**: JWKS-Fetch + Signaturvalidierung in `lti-launch`
2. **State/Nonce-Persistenz**: Login-Init State + Nonce zwischenspeichern und in Launch validieren
3. **OAuth2 Client-Credentials**: Token-Exchange für AGS Grade Passback
4. **Deep Linking**: LTI Deep Linking Response für Content-Item-Selektion
5. **NRPS**: Names and Role Provisioning Service Integration
6. **Platform-spezifische Adapter**: Moodle, Canvas, Blackboard Anpassungen
