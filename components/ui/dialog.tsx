"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/* モーダル誤閉対策 (限定ブロックリスト方式 + base-ui cancel)
   - 「開く」イベントはすべて通す
   - 「閉じる」イベントは下記の reason のみ明示的にブロック (cancel)
       focus-out      … focus 外れただけで閉じるのは UX 上不要
       close-watcher  … ブラウザ Close-Watcher API 由来 (PC では通常使われない)
   - それ以外 (escape-key / outside-press / close-press / trigger-press /
     imperative-action / none) はすべて通常通り閉じる
   - disablePointerDismissal は base-ui の default (false) に従う → 外クリックで閉じる

   ## なぜ「キーボード入力で閉じる」が以前は起きたのか (= 真因の記録)
   - components/ui/dialog.tsx 側の問題ではなかった
   - app/(employee)/my/trainings/page.tsx 内で `TrainingsGrid` を
     `MyTrainingsPage` の **nested function として宣言** していたため、Textarea の
     onChange が親 state (summaryTexts) を更新する → 親が再レンダー → 新しい
     TrainingsGrid 関数参照 → React が型変更と判定して TrainingsGrid を
     unmount + remount → useState(null) で openId が null に戻り Dialog が消える
   - 修正: TrainingsGrid を module level に抽出 (page.tsx 側で対応)

   ## base-ui の close フロー (cancel() が必要な理由は残しておく)
       this.context.onOpenChange?.(nextOpen, eventDetails);
       if (eventDetails.isCanceled) return;
       this.update({ open: nextOpen });
   onOpenChange 内で単に return しても isCanceled=false のままで base-ui が
   内部 state を強制更新する。ブロックする reason については
   eventDetails.cancel() を呼ぶ必要がある。 */
const BLOCKED_CLOSE_REASONS = new Set([
  'focus-out',
  'close-watcher',
]);

function Dialog({
  onOpenChange,
  ...rest
}: DialogPrimitive.Root.Props) {
  /* onOpenChange が未指定でも cancel() を呼ぶ必要があるため、常にハンドラを差し込む */
  const handleOpenChange = React.useCallback(
    (open: boolean, eventDetails: DialogPrimitive.Root.ChangeEventDetails) => {
      if (!open && BLOCKED_CLOSE_REASONS.has(eventDetails.reason as string)) {
        eventDetails.cancel();
        return;
      }
      onOpenChange?.(open, eventDetails);
    },
    [onOpenChange],
  );
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      onOpenChange={handleOpenChange}
      {...rest}
    />
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  /* 真因 (DialogPopup.d.ts L13-22 で確認): base-ui Popup の `initialFocus` default は
     true (= 最初の tabbable element に focus)。長い Modal で内部ボタン
     (例: 遵守事項詳細の ✓確認しました) が最初の tabbable になると、ブラウザ標準の
     scrollIntoView でそのボタン位置までスクロールされて「開いた瞬間に下端表示」になる。

     対策: initialFocus を popup 自身 (= 最上部、視覚上常に viewport 内) に向ける。
     - focus 対象が viewport 内 → scrollIntoView が発火しない (or noop)
     - 内部ボタンへの auto-focus は完全に起こらない
     - Tab キーで通常通り内部 tabbable をたどれる (UX 後退なし)
     - 旧 useEffect で focus 後に scrollTop=0 を当てる「後追い打ち消し」は場当たり的で
       不安定だったため撤廃。focus を最初から正しい場所に向ける根本対応に切替。 */
  const popupRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={popupRef}
        initialFocus={popupRef}
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
