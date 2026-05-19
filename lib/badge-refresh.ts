/**
 * 未読バッジ即時更新のための window CustomEvent ベース event-bus。
 *
 * 背景:
 * app/(employee)/layout.tsx の未読バッジ取得 useEffect は依存配列 [pathname] のため、
 * 同一ページ内で read action (ViewConfirmButton / compliance agree / training submit /
 * 個別メッセージ既読 等) を実行しても再 fetch せず、別ページに遷移するまで赤バッジが残る。
 *
 * 解決:
 * - read action 成功時に notifyBadgeRefresh() を呼ぶ
 * - layout 側で listenBadgeRefresh(handler) で購読して、handler 内で再 fetch する
 *
 * SSR (typeof window === 'undefined') セーフ。
 */

const EVENT_NAME = 'staffbase:badge-refresh';

export function notifyBadgeRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT_NAME));
}

/**
 * @returns 解除関数。useEffect の cleanup でそのまま return 可能
 */
export function listenBadgeRefresh(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
