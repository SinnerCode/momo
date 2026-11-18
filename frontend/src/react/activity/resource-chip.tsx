import type { HTMLAttributes } from 'react';
import { Chip } from '@/components/base/badges/chip';
import { cx } from '@/utils/cx';

const STRONG_COLORS = {
  blue: 'bg-status-blue-text text-background-primary-default',
  purple: 'bg-status-purple-text text-background-primary-default',
  cyan: 'bg-status-cyan-text text-background-primary-default',
} as const;

/** 高占用沿用 Chip 的 caption 尺寸，用同一语义色的实色强调。 */
export function ResourceChip({ color, high, ...props }: HTMLAttributes<HTMLSpanElement> & {
  color: keyof typeof STRONG_COLORS; high: boolean;
}) {
  if (!high) return <Chip variant="caption" color={color} {...props} />;
  return <span {...props} className={cx(
    'inline-flex items-center justify-center rounded-md px-1.5 py-1 whitespace-nowrap text-caption-1-medium',
    STRONG_COLORS[color],
  )} />;
}
