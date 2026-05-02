'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

/**
 * 公開/非公開トグルスイッチ（migration 141）
 *
 * 4 機能（announcements / compliance_documents / trainings / manuals）共通の
 * is_published ON/OFF UI。iOS 風の左右トグルスイッチ。
 * クリックで supabase.from(table).update() し、親に新しい値を伝える。
 */
type Table = 'announcements' | 'compliance_documents' | 'trainings' | 'manuals';

interface Props {
  table: Table;
  id: string;
  isPublished: boolean;
  onChanged?: (next: boolean) => void;
  /** カード全体クリックに伝播させない */
  stopPropagation?: boolean;
  /** スイッチ横のテキストを表示するか（デフォルト: true） */
  showLabel?: boolean;
}

export function PublishToggleButton({
  table,
  id,
  isPublished,
  onChanged,
  stopPropagation = true,
  showLabel = true,
}: Props) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [val, setVal] = useState(isPublished);

  const handleClick = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (busy) return;
    const next = !val;
    const warning = next
      ? '【公開】に切り替えます。\n\n⚠️ 社員画面に表示されます。よろしいですか？'
      : '【非公開】に切り替えます。\n\n⚠️ 社員画面から見えなくなります。よろしいですか？';
    if (!confirm(warning)) return;
    setBusy(true);
    setVal(next); // 楽観更新
    const { error } = await supabase.from(table).update({ is_published: next }).eq('id', id);
    setBusy(false);
    if (error) {
      setVal(!next); // ロールバック
      toast.error('公開状態の更新に失敗しました', { description: error.message });
      return;
    }
    onChanged?.(next);
    toast.success(next ? '公開しました' : '非公開にしました');
  };

  return (
    <span className="inline-flex items-center gap-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={val}
        aria-label={val ? '公開中（クリックで非公開に切替）' : '非公開（クリックで公開に切替）'}
        title={val ? '公開中。クリックで非公開に切替' : '非公開。クリックで公開に切替'}
        onClick={handleClick}
        disabled={busy}
        className={`
          relative inline-flex shrink-0 items-center
          h-6 w-11 rounded-full transition-colors duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${val ? 'bg-emerald-500' : 'bg-gray-300'}
        `}
      >
        <span
          className={`
            inline-block h-5 w-5 rounded-full bg-white shadow
            transform transition-transform duration-200
            ${val ? 'translate-x-[22px]' : 'translate-x-[2px]'}
          `}
        />
      </button>
      {showLabel && (
        <span className={`text-xs font-bold ${val ? 'text-emerald-700' : 'text-gray-500'}`}>
          {val ? '公開' : '非公開'}
        </span>
      )}
    </span>
  );
}
