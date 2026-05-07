'use client';

/**
 * カテゴリ管理モーダル — 各コンテンツページ（遵守事項/研修/お知らせ/業務マニュアル）から
 * 起動して、対応する CategoryType のカテゴリだけを編集できるようにする。
 *
 * 元々は /admin/settings の カテゴリタブに集約されていたが、
 * 各機能の文脈で管理したい方が自然なのでこちらに分散。
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CategoryManager } from './CategoryManager';
import type { CategoryType } from '@/lib/types';

interface Props {
  type: CategoryType;
  /** ボタンに表示する文言（デフォルト「📁 カテゴリ管理」） */
  triggerLabel?: string;
  /** カテゴリが追加・編集・削除・並び替えされたら呼ぶ。親画面の categories state を再取得して、
      モーダルを閉じなくても親側の一覧・フィルタに即反映するために使う */
  onChanged?: () => void | Promise<void>;
}

export function CategoryManagerModal({ type, triggerLabel = '📁 カテゴリ管理', onChanged }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Dialog 基底に sm:max-w-sm の縛りがあるので sm:max-w-5xl で上書き必須。
           w-[92vw] で画面幅の 92% を取る。 */}
        <DialogContent className="w-[92vw] sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>カテゴリ管理</DialogTitle>
          </DialogHeader>
          <div className="pt-2">
            <CategoryManager type={type} onChanged={onChanged} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
