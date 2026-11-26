import type { DiffFile } from '../../src/shared/diff.js';
import { useTexts } from './i18n.js';

export function StatusTag({ status }: { status: DiffFile['status'] }) {
  return <span className={`tag ${status}`}>{useTexts().status[status]}</span>;
}
