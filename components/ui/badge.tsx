import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-diletto-ink text-white",
        secondary: "border-transparent bg-diletto-beige text-diletto-ink",
        destructive: "border-transparent bg-diletto-red/10 text-diletto-red",
        outline: "border-diletto-gray/30 text-diletto-gray",
        success: "border-transparent bg-diletto-green/10 text-diletto-green",
        warning: "border-transparent bg-diletto-gold/10 text-diletto-gold",
        info: "border-transparent bg-diletto-blue/10 text-diletto-blue",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
