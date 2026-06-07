import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface InputProps extends ComponentProps<"input"> {}

export function Input({ className, ...props }: InputProps) {
  return <input className={cn("ui-input", className)} data-slot="input" {...props} />;
}
