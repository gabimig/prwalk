/**
 * Whether the person has clicked or typed in this page yet. Browsers only let a page speak after
 * that, so a script that arrives before it waits behind the Start card.
 */
let interacted = false;

for (const type of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(
    type,
    () => {
      interacted = true;
    },
    { capture: true, once: true },
  );
}

export function hasInteracted(): boolean {
  return interacted;
}
