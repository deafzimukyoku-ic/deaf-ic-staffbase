'use client';

/* 175: 初回ログイン時に「職員ステーションの使い方」マニュアルへ誘導するダイアログ。
   - employees.manual_intro_first_seen_at が NULL なら 1 度だけ表示
   - 「マニュアルを見る」or「あとで」どちらでも DB に now() を打って二度と出ない
   - 「マニュアルを見る」→ /my/manuals?category=<カテゴリ id> へ遷移して該当カテゴリを開いた状態で表示 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  employeeId: string;
  /** 「職員ステーションの使い方」カテゴリ id (見つからない場合は /my/manuals だけに遷移) */
  manualCategoryId: string | null;
  onClose: () => void;
}

export function ManualIntroDialog({ employeeId, manualCategoryId, onClose }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  /* どちらのボタンでも first_seen_at を打って再表示を抑止する。
     失敗しても UI は閉じる (DB 失敗で永遠に表示される方が UX 悪い) */
  async function dismiss(navigate: boolean) {
    setBusy(true);
    try {
      await supabase
        .from('employees')
        .update({ manual_intro_first_seen_at: new Date().toISOString() })
        .eq('id', employeeId)
        .is('manual_intro_first_seen_at', null);
    } catch {
      /* noop */
    } finally {
      setBusy(false);
      onClose();
      if (navigate) {
        const url = manualCategoryId
          ? `/my/manuals?category=${manualCategoryId}`
          : '/my/manuals';
        router.push(url);
      }
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(false); }}>
      <DialogContent className="w-[92vw] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>👋 職員ステーションへようこそ</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3 text-sm">
          <p>はじめての方は、まず<strong>「職員ステーションの使い方」</strong>マニュアルをご確認ください。</p>
          <p className="text-xs text-muted-foreground">
            このご案内は最初の 1 回だけ表示されます。あとからは「業務マニュアル」ページからいつでも開けます。
          </p>
        </div>
        <div className="-mx-4 -mb-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t bg-muted/50 p-3">
          <Button variant="outline" onClick={() => dismiss(false)} disabled={busy}>
            あとで
          </Button>
          <Button onClick={() => dismiss(true)} disabled={busy}>
            📘 マニュアルを見る
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
