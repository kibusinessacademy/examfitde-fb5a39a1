import { useState, useCallback } from 'react';
import type { ShareEvent } from '@/types/share';

/**
 * Manages the state for showing the share success modal.
 * Call `triggerShare(event)` after detecting an eligible share event.
 */
export function useShareTrigger() {
  const [activeEvent, setActiveEvent] = useState<ShareEvent | null>(null);
  const [open, setOpen] = useState(false);

  const triggerShare = useCallback((event: ShareEvent) => {
    setActiveEvent(event);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActiveEvent(null);
  }, []);

  return {
    activeEvent,
    open,
    triggerShare,
    close,
    setOpen,
  };
}
