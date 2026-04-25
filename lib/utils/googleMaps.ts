/**
 * Google Maps 検索URLを生成する。
 *
 * - search/?api=1&query=... 形式は iOS/Android のGoogle Mapsアプリ・
 *   デスクトップブラウザの両方でサポートされる公式推奨形式。
 * - モバイルで Google Maps アプリがインストールされている場合は
 *   自動的にアプリが起動する（何も追加設定不要）。
 * - 住所・場所名・ランドマーク・緯度経度 すべてクエリに渡せる。
 *
 * 参考: https://developers.google.com/maps/documentation/urls/get-started
 */
export function buildGoogleMapsSearchUrl(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

/**
 * 場所テキスト（住所メモ）からGoogle Mapsリンクを開く。
 * @param query 住所・目印・場所名
 * @returns 有効なクエリの場合 true（呼び出し側でユーザーフィードバック可能）
 */
export function openInGoogleMaps(query: string | null | undefined): boolean {
  if (!query) return false;
  const url = buildGoogleMapsSearchUrl(query);
  if (!url) return false;
  /* 新タブ（モバイルでは Google Maps アプリが URL を乗っ取り起動） */
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
