import { useState } from 'react';
import type { ViewerUpdate } from '../../src/shared/protocol.js';
import { useTexts } from './i18n.js';

/** The version whose notice the person hid; a newer one shows again. */
const DISMISSED_KEY = 'prwalk.update.dismissed';

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * A quiet notice that a newer prwalk has been released, with a hint to ask the agent to update.
 * It runs nothing: only the agent updates, through `prwalk update`. The × hides it for that
 * version.
 */
export function UpdateNotice({ update }: { update: ViewerUpdate | null }) {
  const t = useTexts();
  const [dismissed, setDismissed] = useState(dismissedVersion);
  if (update === null || dismissed === update.latest) return null;
  const hide = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, update.latest);
    } catch {}
    setDismissed(update.latest);
  };
  return (
    <div className="update">
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: focusing it shows the hint, as hovering does. */}
      <span className="update-label" tabIndex={0} aria-describedby="update-hint">
        {t.updateAvailable(update.latest)}
      </span>
      <button
        type="button"
        className="update-close"
        aria-label={t.updateDismiss(update.latest)}
        title={t.updateDismiss(update.latest)}
        onClick={hide}
      >
        ×
      </button>
      <span className="update-hint" id="update-hint" role="tooltip">
        {t.updateHint}
      </span>
    </div>
  );
}
