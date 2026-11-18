import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { fitSkeleton } from '@peach/legacy/ui';

/** 等待文字原位换成同宽骨架；保留文字的尺寸和外层控件。 */
export function AsyncText({ text, busy, placeholder }: { text: string | undefined; busy: boolean; placeholder?: ReactNode }) {
  const node = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | undefined>(text);
  const shown = text ?? previous.current;
  useLayoutEffect(() => {
    if (text === undefined) {
      if (shown === undefined) fitSkeleton(node.current);
      return;
    }
    previous.current = text;
  }, [text, shown]);
  return <span data-async-text="" aria-busy={busy || undefined} className="relative inline-grid align-baseline">
    <span ref={node} data-async-text-value="" aria-hidden={busy && shown !== undefined || undefined}>
      {shown === undefined ? placeholder : shown}
    </span>
    {shown !== undefined ? <span aria-hidden="true" data-async-text-skeleton=""
      className="async-text-skeleton skeleton-sheen pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-md" /> : null}
  </span>;
}
