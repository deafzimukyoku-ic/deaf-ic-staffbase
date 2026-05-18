'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { enqueueNotification, cancelNotification } from '@/lib/notifications/queue';
import type { NotificationContentType } from '@/lib/types';

const TABLE_TO_CONTENT_TYPE: Record<'announcements' | 'compliance_documents' | 'trainings' | 'manuals', NotificationContentType> = {
  announcements: 'announcement',
  compliance_documents: 'compliance',
  trainings: 'training',
  manuals: 'manual',
};

/**
 * 一括公開/非公開トグル（migration 141）
 *
 * 渡された items[] の公開状態を集約して、個別トグル（PublishToggleButton）と同じ
 * iOS 風スイッチで一括 ON/OFF。
 *
 * - 全件 published → 緑（ON）。タップで「全件非公開」確認 → 全 OFF
 * - 1 件でも非公開混在 or 全 OFF → グレー（OFF）。タップで「全件公開」確認 → 全 ON
 *
 * カテゴリ未選択ビュー → 全 items を渡せば「全体一括」
 * カテゴリ選択ビュー   → カテゴリ内 items だけ渡せば「カテゴリ別一括」
 */
type Table = 'announcements' | 'compliance_documents' | 'trainings' | 'manuals';

export interface BulkPublishItem {
  id: string;
  is_published: boolean;
}

interface Props {
  table: Table;
  items: BulkPublishItem[];
  onChanged?: () => void;
  /** "全体" / "このカテゴリ" など */
  scopeLabel?: string;
  /** このロール (e.g. 'manager') では実行不可。クリック時に alert で通知してブロックする */
  restrictedFor?: string;
  /** 現在のユーザーのロール。restrictedFor との比較に使う */
  currentUserRole?: string;
}

export function BulkPublishButtons({ table, items, onChanged, scopeLabel, restrictedFor, currentUserRole }: Props) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  if (items.length === 0) return null;

  const total = items.length;
  const publishedCount = items.filter((i) => i.is_published).length;
  const allPublished = publishedCount === total;
  // ON: 緑（全公開）。OFF: 灰（混在 or 全非公開）
  const isOn = allPublished;

  const apply = async (next: boolean) => {
    if (busy) return;
    /* 権限ガード: restrictedFor に指定されたロール (e.g. manager) は「全体公開/非公開」を実行不可。
       同種の RLS が backend にあるはずだが UI で先回りしてブロックする */
    if (restrictedFor && currentUserRole === restrictedFor) {
      alert('権限がありません\n\n事業所の管理者または本部に変更をお願いしてください');
      return;
    }
    const word = next ? '公開' : '非公開';
    const warning = next
      ? `${scopeLabel ?? ''} ${total}件 を全て【公開】にします。\n\n⚠️ 社員画面に表示されます。本当によろしいですか？`
      : `${scopeLabel ?? ''} ${total}件 を全て【非公開】にします。\n\n⚠️ 社員画面から見えなくなります。本当によろしいですか？`;
    if (!confirm(warning)) return;
    setBusy(true);
    const { error } = await supabase
      .from(table)
      .update({ is_published: next })
      .in(
        'id',
        items.map((i) => i.id),
      );
    setBusy(false);
    if (error) {
      toast.error(`一括${word}に失敗しました`, { description: error.message });
      return;
    }
    /* 各 item ごとに enqueue / cancel を流す。失敗は queue 側で warn ログのみで握る */
    const contentType = TABLE_TO_CONTENT_TYPE[table];
    await Promise.all(
      items.map((i) => (next ? enqueueNotification(contentType, i.id) : cancelNotification(contentType, i.id)))
    );
    toast.success(next ? `${total}件 を公開しました。2時間後に対象社員へメール通知されます。` : `${total}件 を非公開にしました`);
    onChanged?.();
  };

  // mixed 状態: 緑じゃないがその情報は別途バッジで表示
  const mixed = publishedCount > 0 && publishedCount < total;

  return (
    <span className="inline-flex items-center gap-2 select-none">
      {scopeLabel && (
        <span className="text-xs text-diletto-gray-light font-bold">{scopeLabel}:</span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={isOn ? `${total}件全て公開中（クリックで全件非公開）` : `非公開を含む（クリックで全件公開）`}
        title={isOn ? '全件公開中。クリックで全件非公開に切替' : mixed ? `混在: ${publishedCount}/${total} 公開中。クリックで全件公開に切替` : '全件非公開。クリックで全件公開に切替'}
        onClick={() => apply(!isOn)}
        disabled={busy}
        className={`
          relative inline-flex shrink-0 items-center
          h-6 w-11 rounded-full transition-colors duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isOn ? 'bg-emerald-500' : 'bg-gray-300'}
        `}
      >
        <span
          className={`
            inline-block h-5 w-5 rounded-full bg-white shadow
            transform transition-transform duration-200
            ${isOn ? 'translate-x-[22px]' : 'translate-x-[2px]'}
          `}
        />
      </button>
      <span className={`text-xs font-bold ${isOn ? 'text-emerald-700' : 'text-gray-500'}`}>
        {isOn ? '全公開' : mixed ? `${publishedCount}/${total} 公開` : '全非公開'}
      </span>
    </span>
  );
}
