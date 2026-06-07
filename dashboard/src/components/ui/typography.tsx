import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface TextProps extends ComponentProps<"p"> {
  variant?: "default" | "description" | "eyebrow" | "success";
}

export function Text({ className, variant = "default", ...props }: TextProps) {
  return (
    <p className={cn("ui-text", `ui-text--${variant}`, className)} data-slot="text" {...props} />
  );
}
