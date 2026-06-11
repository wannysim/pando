import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface AlertProps extends ComponentProps<"div"> {
  variant?: "default" | "destructive" | "success";
}

export function Alert({ className, variant = "default", ...props }: AlertProps) {
  return (
    <div
      className={cn("ui-alert", `ui-alert--${variant}`, className)}
      data-slot="alert"
      {...props}
    />
  );
}
