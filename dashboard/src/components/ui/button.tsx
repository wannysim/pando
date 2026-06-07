import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface ButtonProps extends ComponentProps<"button"> {
  size?: "default" | "sm" | "icon";
  variant?: "default" | "destructive" | "ghost" | "link" | "outline" | "secondary";
}

export function Button({
  className,
  size = "default",
  variant = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "ui-button",
        `ui-button--${variant}`,
        size !== "default" && `ui-button--${size}`,
        className,
      )}
      data-slot="button"
      {...props}
    />
  );
}
