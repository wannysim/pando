import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface CodeBlockProps extends ComponentProps<"code"> {}

export function CodeBlock({ className, ...props }: CodeBlockProps) {
  return <code className={cn("ui-code-block", className)} data-slot="code-block" {...props} />;
}
