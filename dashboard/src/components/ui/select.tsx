import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface SelectProps extends ComponentProps<"select"> {}

export function Select({ className, ...props }: SelectProps) {
  return <select className={cn("ui-select", className)} data-slot="select" {...props} />;
}
