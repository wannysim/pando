import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

type ShineBorderProps = ComponentProps<"span">;

export function ShineBorder({ className, ...props }: ShineBorderProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("magic-shine-border", className)}
      data-slot="magicui-shine-border"
      {...props}
    />
  );
}
