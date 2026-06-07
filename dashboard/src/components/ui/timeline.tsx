import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface TimelineProps extends ComponentProps<"ol"> {}

export function Timeline({ className, ...props }: TimelineProps) {
  return <ol className={cn("ui-timeline", className)} data-slot="timeline" {...props} />;
}

interface TimelineItemProps extends ComponentProps<"li"> {}

export function TimelineItem({ className, ...props }: TimelineItemProps) {
  return <li className={cn("ui-timeline-item", className)} data-slot="timeline-item" {...props} />;
}
