import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** When true, the component requests the mic stream (passive — does not capture) and renders the live waveform. */
  active: boolean;
  bars?: number;
  className?: string;
}

/**
 * Live mic waveform — canvas-based, frequency-bar style.
 *
 * Visual feedback only. Audio is read via WebAudio AnalyserNode and never
 * transmitted or stored. Reuses an existing mic permission grant; if the
 * stream cannot be obtained, the component renders inert bars (no error).
 *
 * Respects `prefers-reduced-motion` by rendering a static pulse instead of
 * the animated waveform.
 */
export function OralWaveform({ active, bars = 14, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      stopAll();
      return;
    }

    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AC();
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;
        render(prefersReduced);
      } catch {
        /* permission denied or unsupported — silent fallback */
      }
    };

    start();

    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bars]);

  const stopAll = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    streamRef.current = null;
    try {
      ctxRef.current?.close();
    } catch {
      /* noop */
    }
    ctxRef.current = null;
    analyserRef.current = null;
  };

  const render = (reduced: boolean) => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };
    resize();

    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const c = canvas.getContext("2d");
      if (!c) return;
      c.clearRect(0, 0, canvas.width, canvas.height);
      const W = canvas.width;
      const H = canvas.height;
      const gap = Math.max(2, Math.floor(W / (bars * 5)));
      const barW = Math.max(2, Math.floor((W - gap * (bars - 1)) / bars));

      if (analyser && data) analyser.getByteFrequencyData(data);

      // Read CSS var --ring as accent (HSL components). Fallback: petrol.
      const style = getComputedStyle(document.documentElement);
      const ring = style.getPropertyValue("--ring").trim() || "168 64% 45%";

      for (let i = 0; i < bars; i++) {
        let amp = 0.15;
        if (analyser && data) {
          const idx = Math.floor((i / bars) * data.length);
          amp = Math.max(0.08, data[idx] / 255);
        } else if (reduced) {
          amp = 0.3;
        } else {
          amp = 0.15 + 0.25 * Math.abs(Math.sin(Date.now() / 400 + i));
        }
        const h = Math.max(4, Math.floor(amp * H * 0.95));
        const x = i * (barW + gap);
        const y = (H - h) / 2;
        c.fillStyle = `hsl(${ring} / ${0.5 + amp * 0.5})`;
        const r = Math.min(barW / 2, 6);
        // rounded bar
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + barW - r, y);
        c.quadraticCurveTo(x + barW, y, x + barW, y + r);
        c.lineTo(x + barW, y + h - r);
        c.quadraticCurveTo(x + barW, y + h, x + barW - r, y + h);
        c.lineTo(x + r, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - r);
        c.lineTo(x, y + r);
        c.quadraticCurveTo(x, y, x + r, y);
        c.closePath();
        c.fill();
      }
      if (!reduced) rafRef.current = requestAnimationFrame(draw);
    };
    draw();
  };

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("w-full h-12 block", className)}
    />
  );
}
