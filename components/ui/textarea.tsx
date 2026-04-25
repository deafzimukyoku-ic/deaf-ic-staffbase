import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-diletto-gray/20 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-diletto-gray-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-diletto-blue/40 focus-visible:border-diletto-blue/50 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-200",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
