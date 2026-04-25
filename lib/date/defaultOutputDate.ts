/**
 * 日次出力ページの初期表示日を返す。
 *
 * 仕様（deaf-ic）:
 *   - 平日 (月〜金): 翌日 (= today + 1)
 *   - 土曜:           次の月曜
 *   - 日曜:           翌日の月曜
 *
 * 祝日判定はしない（カレンダー曜日のみ）。ユーザーが日付を切り替えれば祝日も閲覧可。
 */
export function defaultOutputDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0=Sun, 6=Sat
  let addDays: number;
  if (day === 6) addDays = 2;       // Sat -> Mon
  else if (day === 0) addDays = 1;  // Sun -> Mon
  else addDays = 1;                  // Mon-Fri -> next day (Fri -> Sat)
  d.setDate(d.getDate() + addDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
