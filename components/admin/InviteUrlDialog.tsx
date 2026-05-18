'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

/**
 * Resend 送信失敗時に API から返ってきた `inviteLink` を、admin が手動で
 * 別チャネル（LINE / SMS 等）に転送できるよう表示する共通ダイアログ。
 *
 * 招待 URL は Supabase generateLink 由来の recovery link で、デフォルト 1 時間で失効する。
 * UI 側に表示する前提なので URL 自体は機密ではない（本人しか開けない）が、
 * 1 時間以内に共有しないと再生成が必要なため、共有のフットプリントは短く保つこと。
 */
export function InviteUrlDialog({
  open,
  onClose,
  url,
  employeeName,
}: {
  open: boolean;
  onClose: () => void;
  url: string | null;
  employeeName?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('招待 URL をコピーしました');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('コピーに失敗しました。テキストを直接選択してください。');
    }
  }

  if (!url) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>📨 招待 URL（メール送信失敗）</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-brand-gray">
            {employeeName ? <strong>{employeeName} さん</strong> : '対象者'} 向けの招待メールが
            自動送信できませんでした（Resend 上限などが原因）。
          </p>
          <p className="text-brand-gray">
            以下の URL を <strong>LINE / SMS / 別メール</strong> 等で
            <strong className="text-brand-red">1 時間以内</strong>に共有してください。
            URL を開いてパスワードを設定すると初回ログイン完了です。
          </p>
          <textarea
            readOnly
            value={url}
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="w-full p-3 font-mono text-xs bg-brand-beige/30 border border-brand-gray/20 rounded-md break-all resize-none"
            rows={4}
          />
          <p className="text-[10px] text-brand-gray-light">
            ※ 1 時間を超えたら再送信ボタンから新しい URL を発行できます。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>閉じる</Button>
          <Button onClick={handleCopy}>
            {copied ? '✓ コピー済み' : 'URL をコピー'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
