import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-sm font-medium whitespace-nowrap transition-all duration-300 outline-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "btn-shimmer bg-diletto-ink text-white shadow-sm hover:bg-[#2a2a2a] hover:-translate-y-0.5 active:translate-y-0",
        destructive:
          "bg-diletto-red text-white shadow-sm hover:bg-[#7a2828] active:bg-[#6a2222]",
        outline:
          "border border-diletto-gray/30 bg-white text-diletto-ink shadow-sm hover:border-diletto-ink/60 hover:text-diletto-ink",
        secondary:
          "bg-diletto-beige text-diletto-ink hover:bg-[#eeede8]",
        ghost:
          "text-diletto-gray hover:bg-diletto-beige hover:text-diletto-ink",
        link:
          "text-diletto-blue underline-offset-4 hover:underline",
        gold:
          "btn-shimmer bg-diletto-gold text-white shadow-sm hover:bg-[#7a5618] hover:-translate-y-0.5",
      },
      size: {
        default: "h-10 px-4 py-2",
        xs: "h-7 rounded-md px-2 text-xs",
        sm: "h-9 rounded-md px-3 text-xs",
        lg: "h-11 rounded-md px-8 text-base",
        icon: "h-10 w-10",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
