import * as React from "react"

import { cn } from "@/lib/utils"

/* @base-ui/react の Input は内部で Field.Control を使うため、React 標準の value+onChange
   ペアで制御すると 2文字目以降の入力が無視される（onValueChange が期待される）。
   このプロジェクトでは Field.Root を一切使っておらず、native input で十分なので native に戻す。
   症状: モーダル内で「1文字しか入力できない」「Enter で閉まる」等の不具合の原因。 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-md border border-brand-gray/20 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-brand-gray-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:border-brand-blue/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200",
        className
      )}
      {...props}
    />
  )
}

export { Input }
