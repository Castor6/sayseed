import { describe, expect, it } from 'vitest';
import { adjacentPanel, clampPanel } from './draggable-panel';

describe('floating panel geometry', () => {
  it('keeps a dragged panel fully reachable inside the viewport', () => {
    expect(clampPanel({ top: -90, left: 900 }, { width: 420, height: 500 }, { width: 1000, height: 700 }))
      .toEqual({ top: 12, left: 568 });
    expect(clampPanel({ top: 400, left: 600 }, { width: 420, height: 500 }, { width: 700, height: 600 }))
      .toEqual({ top: 88, left: 268 });
  });

  it('places the explanation on the right, then left, then over the translation on narrow screens', () => {
    expect(adjacentPanel({ top: 40, left: 30 }, 420, 420, 1000)).toEqual({ point: { top: 40, left: 462 }, overlay: false });
    expect(adjacentPanel({ top: 40, left: 500 }, 420, 420, 1000)).toEqual({ point: { top: 40, left: 68 }, overlay: false });
    expect(adjacentPanel({ top: 40, left: 12 }, 420, 420, 700)).toEqual({ point: { top: 12, left: 140 }, overlay: true });
  });
});
