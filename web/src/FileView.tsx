import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { useEffect, useMemo, useRef } from 'react';
import type { DiffFile } from '../../src/shared/diff.js';
import type { ViewerFocus } from '../../src/shared/protocol.js';
import { useTexts } from './i18n.js';
import { StatusTag } from './StatusTag.js';

// Rendered inside the library's shadow root. Dims every line outside the selection and draws
// the selection like the prototype: an accent bar on the left and accent edges.
const FOCUS_CSS = `
:host { --diffs-selection-base: light-dark(#bf8700, #e3b341); }
[data-line], [data-column-number] { transition: opacity .35s; }
[data-line]:not([data-selected-line]), [data-column-number]:not([data-selected-line]) { opacity: .32; }
[data-column-number][data-selected-line] { box-shadow: inset 3px 0 0 light-dark(#bf8700, #e3b341); }
`;

const BASE_OPTIONS = {
  diffStyle: 'unified',
  theme: { light: 'github-light', dark: 'github-dark' },
  themeType: 'system',
  disableFileHeader: true,
} as const;

type Props = {
  file: DiffFile;
  metadata: FileDiffMetadata;
  focus?: ViewerFocus | undefined;
  /** A short label next to the file name: why this file is being shown. */
  note?: string | undefined;
  /** A tag saying this is not a step of the script, like "Answer". */
  label?: string | undefined;
  onBack?: (() => void) | undefined;
};

/** One file of the diff with its header; with a focus, its range highlighted and centred. */
export function FileView({ file, metadata, focus, note, label, onBack }: Props) {
  const t = useTexts();
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const section = useRef<HTMLElement>(null);
  const items = useMemo(
    () => [{ id: file.path, type: 'diff' as const, fileDiff: metadata }],
    [file.path, metadata],
  );
  // A new range for every focus message, even one equal to the last: each focus the agent
  // sends (or the daemon repeats on reconnect) has to bring its lines back into view.
  const range = useMemo<SelectedLineRange | undefined>(
    () =>
      focus === undefined
        ? undefined
        : {
            start: focus.lines[0],
            end: focus.lines[1],
            side: focus.side === 'old' ? 'deletions' : 'additions',
          },
    [focus],
  );
  const focused = range !== undefined;
  const options = useMemo(
    () => (focused ? { ...BASE_OPTIONS, unsafeCSS: FOCUS_CSS } : BASE_OPTIONS),
    [focused],
  );

  // Also scroll again when the items change: a reconnect reloads the diff and redraws the file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items is a trigger, not an input.
  useEffect(() => {
    if (range === undefined) return;
    // Let the view lay out the new selection before measuring where to scroll.
    const frame = requestAnimationFrame(() =>
      view.current?.scrollTo({
        type: 'range',
        id: file.path,
        range,
        align: 'center',
        behavior: 'smooth',
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [file.path, range, items]);

  // When the view changes height (the history grows on pause and covers part of it), centre the
  // range again so it stays in sight.
  useEffect(() => {
    const element = section.current;
    if (range === undefined || element === null) return;
    let height: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.height;
      if (next === undefined) return;
      if (height !== undefined && Math.abs(next - height) > 1) {
        view.current?.scrollTo({ type: 'range', id: file.path, range, align: 'center' });
      }
      height = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [file.path, range]);

  return (
    <section className="file" aria-label={file.path} ref={section}>
      <div className="file-head">
        {onBack && (
          <button type="button" className="back" onClick={onBack}>
            {t.allFiles}
          </button>
        )}
        {label !== undefined && <span className="aside-tag">{label}</span>}
        <StatusTag status={file.status} />
        <span className="path">{file.path}</span>
        {file.oldPath !== undefined && <span className="from">{t.from(file.oldPath)}</span>}
        {note !== undefined && <span className="note">{note}</span>}
        {range !== undefined && (
          <span className="lines">{t.lines(range.start, range.end, focus?.side === 'old')}</span>
        )}
      </div>
      {file.binary || file.hunks.length === 0 ? (
        <p className="empty">{file.binary ? t.binary : t.noLineChanges}</p>
      ) : (
        <CodeView
          ref={view}
          className="code"
          items={items}
          selectedLines={range === undefined ? null : { id: file.path, range }}
          disableWorkerPool
          options={options}
        />
      )}
    </section>
  );
}
