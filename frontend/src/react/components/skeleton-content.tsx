import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { fitSkeleton } from '@peach/legacy/ui';

/** 内容和骨架在同一格交叉淡化，变化区域之外的控件不参与过渡。 */
export function SkeletonContent({ pending, skeletonHtml, children }: {
  pending: boolean; skeletonHtml(): string; children: ReactNode;
}) {
  const previous = useRef<ReactNode>(null);
  const skeleton = useRef<HTMLDivElement>(null);
  const markup = skeletonHtml();
  useLayoutEffect(() => { if (!pending) previous.current = children }, [pending, children]);
  useLayoutEffect(() => { if (pending) fitSkeleton(skeleton.current) }, [pending, markup]);
  return <div data-content-transition="" data-pending={pending ? '' : undefined} aria-busy={pending}>
    <div data-content-current="" inert={pending} aria-hidden={pending || undefined}>
      {pending ? previous.current : children}
    </div>
    <div ref={skeleton} data-content-skeleton="" aria-hidden={!pending || undefined}
      dangerouslySetInnerHTML={{ __html: markup }} />
  </div>;
}
