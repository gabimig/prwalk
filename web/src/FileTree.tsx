import { useEffect, useMemo, useRef, useState } from 'react';
import { pathTargets, type TreeNode } from '../../src/shared/tree.js';
import { useTexts } from './i18n.js';

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
          <div className="row" style={{ paddingLeft: 8 + depth * 14 }} title={node.path}>
            {node.kind === 'dir' ? (
              <>
                <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" />
                </svg>
                <span className="name">{node.name}</span>
                <span className="count" title={t.files(node.files)}>
                  {node.files}
                </span>
              </>
            ) : (
              <>
                <span className={`st ${node.file.status}`} title={t.status[node.file.status]}>
                  {t.statusShort[node.file.status]}
                </span>
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
              </>
            )}
          </div>
          {node.kind === 'dir' && open && (
            // biome-ignore lint/a11y/useSemanticElements: an ARIA tree groups its children like this.
            <ul role="group">{renderNodes(node.children, depth + 1)}</ul>
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
        <path d="M2 3h12v10H2zM3.5 4.5v7h3v-7z" fillRule="evenodd" />
      </svg>
    </button>
  );
}
