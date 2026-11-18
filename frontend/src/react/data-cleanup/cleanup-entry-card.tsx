import { cx } from '@/utils/cx';
import { spriteGlyph, type Glyph } from '../components/sprite-glyph';
import { CLEANUP_ENTRY } from './cleanup-entry';

const Arrow = spriteGlyph('chevron-right');

/** 点击只进入二级页；数量是状态信息，入口本身不执行业务操作。 */
export function CleanupEntryCard({ label, icon: Icon, summary, detail, state, attributes, onOpen }: {
  label: string;
  icon: Glyph;
  summary: string;
  detail?: string;
  state?: 'loading' | 'error';
  attributes: Record<`data-${string}`, string>;
  onOpen(): void;
}) {
  return <button type="button" {...attributes} className={CLEANUP_ENTRY.face} onClick={onOpen}
    data-entry-state={state} aria-busy={state === 'loading' || undefined}>
    <span aria-hidden className={CLEANUP_ENTRY.icon}><Icon aria-hidden className="size-5" /></span>
    <span className={CLEANUP_ENTRY.body}>
      <span className={CLEANUP_ENTRY.title}>{label}</span>
      <span className={cx(CLEANUP_ENTRY.summary, state === 'error' && 'text-text-error-primary')}>{summary}</span>
      {detail ? <span className={CLEANUP_ENTRY.detail}>{detail}</span> : null}
    </span>
    <Arrow aria-hidden className={CLEANUP_ENTRY.arrow} />
  </button>;
}
