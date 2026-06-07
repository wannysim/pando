import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface SkeletonProps extends ComponentProps<"div"> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn("ui-skeleton", className)} data-slot="skeleton" {...props} />;
}
