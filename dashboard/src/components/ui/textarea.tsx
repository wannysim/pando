import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface TextareaProps extends ComponentProps<"textarea"> {}

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={cn("ui-textarea", className)} data-slot="textarea" {...props} />;
}
