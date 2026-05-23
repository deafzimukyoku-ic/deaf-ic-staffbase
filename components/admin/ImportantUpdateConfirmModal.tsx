'use client';

/**
 * 「重要な変更として再通知する」確認モーダル（E2 / deaf-ic）。
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { notifyPushOnPublish } from '@/lib/push/notify-publish-client';

type ContentType = 'announcement' | 'compliance' | 'training' | 'manual';

interface Props {
  open: boolean;
  contentType: ContentType;
  itemId: string;
  itemTitle?: string;
  onClose: () => void;
}

export function ImportantUpdateConfirmModal({ open, contentType, itemId, itemTitle, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const handleResend = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await notifyPushOnPublish(contentType, itemId, 'important_update');
      toast.success('再通知を送信しました。社員のスマホに通知が届きます。');
    } catch (err) {
      toast.error('再通知の送信に失敗しました', { description: err instanceof Error ? err.message : '' });
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">変更を保存しました</h3>
        <p className="text-sm text-gray-700 mb-1">
          {itemTitle ? `『${itemTitle}』を更新しました。` : '更新を保存しました。'}
        </p>
        <p className="text-sm text-gray-700 mb-4">
          社員に「重要な更新があります」と再通知しますか？
        </p>
        {contentType !== 'training' && (
          <p className="text-xs text-gray-500 mb-4">
            ※ 再通知すると、対象社員の既読がリセットされ、未読バッジが復活します。
          </p>
        )}
        {contentType === 'training' && (
          <p className="text-xs text-gray-500 mb-4">
            ※ 研修は既読リセットされません（提出データは保持されます）。
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            後にする
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '送信中...' : '再通知する'}
          </button>
        </div>
      </div>
    </div>
  );
}
