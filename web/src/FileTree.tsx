import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffFile } from '../../src/shared/diff.js';
import { pathTargets, type TreeNode } from '../../src/shared/tree.js';
import { useTexts } from './i18n.js';

// Icons drawn after GitHub's Octicons (MIT), inline so the page loads nothing more.
const FOLDER =
  'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z';
const FILE =
  'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z';
const BOX =
  'M13.25 1c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 15H2.75A1.75 1.75 0 0 1 1 13.25V2.75C1 1.784 1.784 1 2.75 1ZM2.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25Z';
const STATUS: Record<DiffFile['status'], string> = {
  added:
    'M8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4Z',
  modified: 'M8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z',
  deleted: 'M11.25 8.75h-6.5a.75.75 0 0 1 0-1.5h6.5a.75.75 0 0 1 0 1.5Z',
  renamed:
    'M11.78 8.53l-3.25 3.25a.749.749 0 0 1-1.06-1.06l1.97-1.97H4.75a.75.75 0 0 1 0-1.5h4.69L7.47 5.28a.75.75 0 0 1 1.06-1.06l3.25 3.25a.75.75 0 0 1 0 1.06Z',
};

/** What a card step points at: its paths, and whether the rest of the tree is dimmed more. */
export type TreeLight = { paths: string[]; sentence: boolean };

type Props = {
  nodes: TreeNode[];
  /** The file shown in the diff panel, marked as current. */
  current?: string | undefined;
  light?: TreeLight | undefined;
  onOpen: (path: string) => void;
};

/**
 * The changed files beside the diff, like GitHub's file tree: folders fold with a click, the
 * current file is marked and kept in view, and the paths a card points at are lit. Keyboard: the
 * arrows move and fold, Enter or Space opens; while focus is in it the player's shortcuts wait.
 */
export function FileTree({ nodes, current, light, onOpen }: Props) {
  const t = useTexts();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);

  const lightKey = JSON.stringify(light ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed only when what is lit changes.
  const lit = useMemo(() => {
    const rows = new Set<string>();
    for (const path of light?.paths ?? []) {
      for (const row of pathTargets(nodes, path)) rows.add(row);
    }
    return rows;
  }, [nodes, lightKey]);

  // Unfold the folders above the current file and above what is lit, so they can be seen.
  useEffect(() => {
    const shown = current === undefined ? [...lit] : [current, ...lit];
    if (shown.length === 0) return;
    setCollapsed((folded) => {
      const kept = new Set(
        [...folded].filter((dir) => !shown.some((path) => path.startsWith(`${dir}/`))),
      );
      return kept.size === folded.size ? folded : kept;
    });
  }, [current, lit]);

  // Scroll the tree itself (not the page) so the current file is in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unfolding moves the row, so scroll again.
  useEffect(() => {
    const box = container.current;
    if (box === null || current === undefined) return;
    const frame = requestAnimationFrame(() => {
      const element = box.querySelector(`[data-id="${CSS.escape(`file:${current}`)}"] > .row`);
      if (!(element instanceof HTMLElement)) return;
      const top = element.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (top < 0 || top + element.offsetHeight > box.clientHeight) {
        box.scrollTo({ top: box.scrollTop + top - box.clientHeight / 2, behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [current, collapsed]);

  const visible = useMemo(() => visibleRows(nodes, collapsed), [nodes, collapsed]);
  const tabStop = visible.some((row) => row.node.id === focused)
    ? focused
    : current !== undefined
      ? `file:${current}`
      : visible[0]?.node.id;

  const toggle = (path: string) =>
    setCollapsed((folded) => {
      const next = new Set(folded);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const activate = (node: TreeNode) => {
    setFocused(node.id);
    if (node.kind === 'dir') toggle(node.path);
    else onOpen(node.path);
  };

  const moveTo = (id: string | undefined) => {
    if (id === undefined) return;
    setFocused(id);
    container.current
      ?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
      ?.focus({ preventScroll: false });
  };

  /** The keys of the row with the keyboard focus; true if the key was used. */
  const onKey = (node: TreeNode, key: string): boolean => {
    const at = visible.findIndex((row) => row.node.id === node.id);
    const open = node.kind === 'dir' && !collapsed.has(node.path);
    switch (key) {
      case 'ArrowDown':
        moveTo(visible[at + 1]?.node.id);
        return true;
      case 'ArrowUp':
        moveTo(visible[at - 1]?.node.id);
        return true;
      case 'Home':
        moveTo(visible[0]?.node.id);
        return true;
      case 'End':
        moveTo(visible[visible.length - 1]?.node.id);
        return true;
      case 'ArrowRight':
        if (open) moveTo(visible[at + 1]?.node.id);
        else if (node.kind === 'dir') toggle(node.path);
        return true;
      case 'ArrowLeft':
        if (open) toggle(node.path);
        else moveTo(visible[at]?.parent);
        return true;
      case 'Enter':
      case ' ':
        activate(node);
        return true;
      default:
        return false;
    }
  };

  const renderNodes = (list: TreeNode[], depth: number) =>
    list.map((node) => {
      const isLit = lit.has(node.path);
      const isCurrent = node.kind === 'file' && node.path === current;
      const open = node.kind === 'dir' && !collapsed.has(node.path);
      return (
        <li
          key={node.id}
          role="treeitem"
          data-id={node.id}
          aria-label={node.path}
          aria-level={depth + 1}
          aria-expanded={node.kind === 'dir' ? open : undefined}
          aria-current={isCurrent ? 'true' : undefined}
          data-lit={isLit ? 'true' : undefined}
          tabIndex={node.id === tabStop ? 0 : -1}
          onFocus={(event) => {
            if (event.target === event.currentTarget) setFocused(node.id);
          }}
          // A click leaves the keyboard to the player's shortcuts, as its other buttons do.
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // Rows are nested: only the innermost one clicked acts.
            event.stopPropagation();
            activate(node);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            if (onKey(node, event.key)) event.preventDefault();
          }}
        >
          <div className="row" style={{ paddingLeft: 8 + depth * 16 }} title={node.path}>
            {node.kind === 'dir' ? (
              <>
                <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <svg className="icon folder" viewBox="0 0 16 16" aria-hidden="true">
                  <path d={FOLDER} />
                </svg>
                <span className="name">{node.name}</span>
                <span className="count" title={t.files(node.files)}>
                  {node.files}
                </span>
              </>
            ) : (
              <>
                <svg className="icon file" viewBox="0 0 16 16" aria-hidden="true">
                  <path d={FILE} />
                </svg>
                <span className="name">{node.name}</span>
                <span className="counts">
                  {node.file.binary ? (
                    'bin'
                  ) : (
                    <>
                      <span className="plus">+{node.file.additions}</span>{' '}
                      <span className="minus">−{node.file.deletions}</span>
                    </>
                  )}
                </span>
                <svg className={`st ${node.file.status}`} viewBox="0 0 16 16" role="img">
                  <title>{t.status[node.file.status]}</title>
                  <path d={`${BOX}${STATUS[node.file.status]}`} />
                </svg>
              </>
            )}
          </div>
          {node.kind === 'dir' && open && (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA tree groups its children like this.
            <ul role="group" style={{ '--guide': `${8 + depth * 16 + 4}px` } as CSSProperties}>
              {renderNodes(node.children, depth + 1)}
            </ul>
          )}
        </li>
      );
    });

  const pointing = light === undefined ? '' : light.sentence ? ' pointing strong' : ' pointing';
  return (
    <div className={`files tree-panel${pointing}`} ref={container}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA tree pattern is a list. */}
      <ul role="tree" aria-label={t.filesLabel}>
        {renderNodes(nodes, 0)}
      </ul>
    </div>
  );
}

/** `parent` is the id of the folder row it is in. */
type VisibleRow = { node: TreeNode; parent: string | undefined };

/** The rows on screen, top to bottom: everything but what is inside a folded folder. */
function visibleRows(nodes: TreeNode[], collapsed: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (list: TreeNode[], parent: string | undefined) => {
    for (const node of list) {
      rows.push({ node, parent });
      if (node.kind === 'dir' && !collapsed.has(node.path)) walk(node.children, node.id);
    }
  };
  walk(nodes, undefined);
  return rows;
}

const STORAGE_KEY = 'prwalk.tree';

/**
 * Whether the person wants the tree shown: what they chose last time in this browser, else open
 * if the page is at least 720 px wide.
 */
export function useTreeOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'open' || saved === 'closed') return saved === 'open';
    } catch {
      // Storage can be blocked; fall back to the width.
    }
    return window.innerWidth >= 720;
  });
  const choose = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'open' : 'closed');
    } catch {
      // Not remembered, but still applied.
    }
  };
  return [open, choose];
}

/** The button that shows and hides the tree. */
export function TreeToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTexts();
  const label = open ? t.hideTree : t.showTree;
  return (
    <button
      type="button"
      className="tree-toggle"
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={(event) => {
        event.currentTarget.blur();
        onToggle();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1ZM1.5 2.75v10.5c0 .138.112.25.25.25H5v-11H1.75a.25.25 0 0 0-.25.25ZM6.5 13.5h7.75a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25H6.5Z" />
      </svg>
    </button>
  );
}
