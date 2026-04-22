/**
 * React-Hook für reaktive Hard-Heal Cooldown-Anzeige.
 * Tickt jede Sekunde solange Cooldown aktiv ist, sonst idle.
 */
import { useEffect, useState } from "react";
import {
  getHardHealCooldownRemaining,
  formatCooldown,
} from "./healCooldown";

export function useHardHealCooldown(packageId: string | null | undefined) {
  const [remaining, setRemaining] = useState<number>(() =>
    packageId ? getHardHealCooldownRemaining(packageId) : 0,
  );

  useEffect(() => {
    if (!packageId) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(getHardHealCooldownRemaining(packageId));
    tick();
    const id = window.setInterval(tick, 1000);
    const onChange = () => tick();
    window.addEventListener("heal-cooldown-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("heal-cooldown-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [packageId]);

  return {
    remainingMs: remaining,
    isOnCooldown: remaining > 0,
    label: formatCooldown(remaining),
  };
}
