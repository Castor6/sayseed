import type { ReasoningEffort } from '@sayseed/shared';

const labels: Record<ReasoningEffort, string> = {
  none: '关闭',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
};

export function reasoningEffortLabel(value: ReasoningEffort) {
  return value === 'none' ? labels[value] : `${labels[value]}（${value}）`;
}
