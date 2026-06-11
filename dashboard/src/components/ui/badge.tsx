import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps extends ComponentProps<"span"> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "success" | "warning";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn("ui-badge", `ui-badge--${variant}`, className)}
      data-slot="badge"
      {...props}
    />
  );
}
