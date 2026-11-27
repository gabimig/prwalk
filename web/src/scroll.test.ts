import { describe, expect, it } from 'vitest';
import { scrollToShow } from './scroll.js';

describe('scrollToShow', () => {
  const view = { top: 100, bottom: 300 };

  it('does not move when the block is already in view', () => {
    expect(scrollToShow(view, { top: 120, bottom: 280 })).toBeUndefined();
  });

  it('centres a block that fits', () => {
    expect(scrollToShow(view, { top: 500, bottom: 600 })).toBe(450);
  });

  it('puts the first line of a block taller than the view at the top', () => {
    expect(scrollToShow(view, { top: 500, bottom: 1000 })).toBe(500);
    expect(scrollToShow({ top: 500, bottom: 700 }, { top: 400, bottom: 1000 })).toBe(400);
  });
});
