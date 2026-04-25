'use client';

import { CategoryBadge } from '@/components/admin/CategorySelect';
import { NewBadge } from '@/components/admin/NewBadge';
import type { Category } from '@/lib/types';

// 案C: カードグリッド用の共通カード
// クリックすると親コンポーネント側で詳細モーダルを開く

interface Props {
  title: string;
  excerpt: string;
  createdAt: string | null | undefined;
  category?: Category | null;
  acknowledged: boolean;
  ackLabel?: string; // 「確認済」「既読」「合格」等
  pendingLabel?: string; // 「要確認」「未読」「未受講」等
  hasMedia?: boolean;
  onClick: () => void;
}

export function ItemGridCard({
  title, excerpt, createdAt, category, acknowledged,
  ackLabel = '確認済', pendingLabel = '要確認',
  hasMedia, onClick,
}: Props) {
  // カテゴリの色をカードに反映する
  // - 左側に太いアクセントバー (4px)
  // - 上部にカテゴリ色のごく薄い背景ティント (8% 不透明度)
  // 未確認 (要確認) のカードはより強調
  const catColor = category?.color || '#94a3b8';

  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col text-left h-full pl-5 pr-4 py-4 bg-white rounded-md border shadow-sm hover:shadow-md transition-all overflow-hidden ${
        acknowledged
          ? 'border-diletto-gray/10'
          : 'border-diletto-red/30 ring-1 ring-diletto-red/10'
      }`}
      style={{
        // 上から下へカテゴリ色の薄いグラデーション (上 12% → 下 透明)
        backgroundImage: category
          ? `linear-gradient(to bottom, ${catColor}22 0%, ${catColor}00 80px)`
          : undefined,
      }}
    >
      {/* 左側のアクセントバー */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1.5"
        style={{ backgroundColor: catColor }}
      />

      {/* 上段: バッジ */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <CategoryBadge category={category} />
        <NewBadge createdAt={createdAt} />
        {acknowledged ? (
          <span className="text-[10px] bg-diletto-green/10 text-diletto-green border border-diletto-green/30 px-1.5 py-0.5 rounded font-bold">✓ {ackLabel}</span>
        ) : (
          <span className="text-[10px] bg-diletto-red text-white px-1.5 py-0.5 rounded font-bold">{pendingLabel}</span>
        )}
        {hasMedia && (
          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">📎 添付</span>
        )}
      </div>

      {/* タイトル */}
      <h3 className="text-base font-bold text-diletto-ink line-clamp-2 mb-2">{title || '（無題）'}</h3>

      {/* 抜粋 */}
      <p className="text-xs text-diletto-gray line-clamp-3 leading-relaxed flex-1">
        {excerpt || '（本文なし）'}
      </p>

      {/* フッタ: 開くリンクのみ（既読/未読バッジは上段に統合済） */}
      <div className="flex items-center justify-end mt-3 pt-3 border-t border-diletto-gray/5">
        <span className="text-[10px] text-diletto-gray-light group-hover:text-diletto-blue transition-colors">
          開く →
        </span>
      </div>
    </button>
  );
}

// content_blocks から抜粋テキストを取り出す
export function blocksToExcerpt(blocks: unknown, fallback?: string | null): string {
  if (Array.isArray(blocks)) {
    const textBlock = blocks.find((b: any) => b?.type === 'text' && typeof b.value === 'string');
    if (textBlock) return (textBlock as { value: string }).value;
  }
  return fallback || '';
}

// content_blocks にメディア（画像/動画/PDF）が含まれるか
export function blocksHaveMedia(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b: any) => b?.type === 'image' || b?.type === 'video' || b?.type === 'pdf');
}
