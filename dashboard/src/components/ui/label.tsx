import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface LabelProps extends ComponentProps<"label"> {}

export function Label({ className, ...props }: LabelProps) {
  return <label className={cn("ui-label", className)} data-slot="label" {...props} />;
}
