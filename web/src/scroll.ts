/** A vertical span in the coordinates of a scrolled box's content. */
export type Span = { top: number; bottom: number };

/**
 * Where to scroll a box whose visible part is `view` so that `block` can be seen: centred if it
 * fits, else from its first line down as far as the box shows. Undefined if that is already in
 * view, so nothing moves.
 */
export function scrollToShow(view: Span, block: Span): number | undefined {
  const height = view.bottom - view.top;
  const end = Math.min(block.bottom, block.top + height);
  if (block.top >= view.top && end <= view.bottom) return undefined;
  return Math.max(0, (block.top + end) / 2 - height / 2);
}

/** Smooth, unless the person asked the system for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
