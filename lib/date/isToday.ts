import { format } from 'date-fns';

/** JST 基準の「今日」を yyyy-MM-dd で返す。ブラウザローカルタイム = 運用環境では JST 想定。 */
export function todayStr(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function isToday(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  return dateStr === todayStr();
}
