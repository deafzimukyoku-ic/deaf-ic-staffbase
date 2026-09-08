/**
 * 全幅（フルブリード）表示にするルートの判定。
 *
 * 背景: (admin)/(manager) layout のコンテンツ枠は `mx-auto w-full max-w-7xl`（=1280px 上限）で、
 * 表系の画面は `-m-6 lg:-m-8` で**パディングだけ**打ち消していた。中央寄せ自体は残るため、
 * 1280px を超える画面幅（ブラウザを 75% ズームした場合など）で表の左右に余白が出ていた。
 * ここで対象ルートを一元管理し、両 layout から同じ判定を使う（二重管理を避ける）。
 *
 * 対象は「横に長い表・帳票」の画面のみ。ダッシュボード・各種設定・社員管理などの
 * 通常ページは従来どおり 1280px 中央寄せのままにする（フォームが横に間延びするため）。
 */

/** admin / manager の接頭辞を除いた、全幅にするパス（完全一致） */
const FULL_BLEED_SUFFIXES = [
  '/shifts', // シフト表（/shifts/dashboard などの下位ページは対象外なので完全一致で判定する）
  '/shifts/schedule', // 利用表
  '/shifts/transport', // 送迎表
  '/shifts/events', // イベント設定
  '/shifts/output/daily', // 日次出力
  '/shifts/output/daily-report', // 業務日報
  '/shifts/output/billing', // 利用料金表
  '/shifts/output/staff-child-overlap', // 同席日数
  '/shifts/output/weekly-transport', // 週次送迎
] as const;

const ROLE_PREFIXES = ['/admin', '/mgr'] as const;

const FULL_BLEED_PATHS: ReadonlySet<string> = new Set(
  ROLE_PREFIXES.flatMap((prefix) => FULL_BLEED_SUFFIXES.map((suffix) => `${prefix}${suffix}`))
);

/**
 * 与えられた pathname が全幅表示の対象か。
 * 末尾スラッシュの有無は吸収する（Next の trailingSlash 設定に依存しないため）。
 */
export function isFullBleedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return FULL_BLEED_PATHS.has(normalized);
}
