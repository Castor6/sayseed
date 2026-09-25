import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface PanelPoint { top: number; left: number }
export interface PanelSize { width: number; height: number }

export function clampPanel(point: PanelPoint, size: PanelSize, viewport: PanelSize, margin = 12): PanelPoint {
  return {
    top: Math.max(margin, Math.min(point.top, viewport.height - size.height - margin)),
    left: Math.max(margin, Math.min(point.left, viewport.width - size.width - margin)),
  };
}

export function adjacentPanel(anchor: PanelPoint, anchorWidth: number, panelWidth: number, viewportWidth: number, gap = 12): { point: PanelPoint; overlay: boolean } {
  const margin = 12;
  const right = anchor.left + anchorWidth + gap;
  if (right + panelWidth + margin <= viewportWidth) return { point: { top: anchor.top, left: right }, overlay: false };
  const left = anchor.left - panelWidth - gap;
  if (left >= margin) return { point: { top: anchor.top, left }, overlay: false };
  return { point: { top: margin, left: Math.max(margin, (viewportWidth - panelWidth) / 2) }, overlay: true };
}

export function useDraggablePanel(anchor: PanelPoint) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; point: PanelPoint } | null>(null);
  const [manual, setManual] = useState<PanelPoint | null>(null);
  const [size, setSize] = useState<PanelSize>({ width: 420, height: 700 });
  const [viewport, setViewport] = useState<PanelSize>(() => ({ width: window.innerWidth, height: window.innerHeight }));

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const rect = panel.getBoundingClientRect();
      if (rect.width && rect.height) setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    return () => observer?.disconnect();
  }, []);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = clampPanel(manual ?? anchor, size, viewport);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button, input, textarea, select, a')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, point };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    setManual(clampPanel({ top: active.point.top + event.clientY - active.y, left: active.point.left + event.clientX - active.x }, size, viewport));
  }

  function stopDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    ref: panelRef,
    point,
    style: { top: point.top, left: point.left },
    handleProps: { onPointerDown, onPointerMove, onPointerUp: stopDrag, onPointerCancel: stopDrag },
  };
}
