/**
 * Hard-Heal Cooldown Tracker (client-side)
 * ────────────────────────────────────────
 * Spiegelt das p_cooldown_minutes=30 Verhalten der RPC im UI:
 * Nach erfolgreichem Hard-Heal ist der Button für 30 Minuten gesperrt,
 * damit der Operator nicht versehentlich denselben Repair erneut auslöst,
 * während der vorherige noch läuft.
 *
 * Persistiert in localStorage damit der Lock auch nach Reload greift.
 * Server-RPC ist die echte SSOT — das ist nur defensive UX.
 */
const STORAGE_KEY = "examfit.heal.hardCooldown.v1";
export const HARD_HEAL_COOLDOWN_MS = 30 * 60 * 1000;

type CooldownMap = Record<string, number>; // packageId → expiresAtMs

function read(): CooldownMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CooldownMap;
    const now = Date.now();
    // GC abgelaufene Einträge
    const cleaned: CooldownMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > now) cleaned[k] = v;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function write(map: CooldownMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("heal-cooldown-changed"));
  } catch {
    /* ignore quota errors */
  }
}

export function setHardHealCooldown(packageId: string, ms = HARD_HEAL_COOLDOWN_MS) {
  const map = read();
  map[packageId] = Date.now() + ms;
  write(map);
}

export function clearHardHealCooldown(packageId: string) {
  const map = read();
  delete map[packageId];
  write(map);
}

export function getHardHealCooldownRemaining(packageId: string): number {
  const map = read();
  const exp = map[packageId];
  if (!exp) return 0;
  return Math.max(0, exp - Date.now());
}

export function isHardHealOnCooldown(packageId: string): boolean {
  return getHardHealCooldownRemaining(packageId) > 0;
}

export function formatCooldown(ms: number): string {
  if (ms <= 0) return "0s";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins >= 1) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
