// 月次完成状態バッジ（ShiftPuzzle 準拠）
// empty 状態は表示しない（null を返す）

type Status = 'empty' | 'incomplete' | 'complete';

interface Props {
  status: Status;
  compact?: boolean;
}

export function MonthStatusBadge({ status, compact }: Props) {
  if (status === 'empty') return null;

  const isComplete = status === 'complete';
  const label = isComplete ? '完成' : '未完成';
  const dot = isComplete ? '●' : '⏳';
  const classes = isComplete
    ? 'bg-diletto-green/10 text-diletto-green border border-diletto-green/20'
    : 'bg-yellow-50 text-yellow-800 border border-yellow-300/40';

  const sizeClasses = compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-bold ${classes} ${sizeClasses}`}>
      <span>{dot}</span>
      <span>{label}</span>
    </span>
  );
}
