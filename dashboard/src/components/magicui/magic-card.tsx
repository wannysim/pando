import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

type MagicCardProps = ComponentProps<"div">;

export function MagicCard({ className, ...props }: MagicCardProps) {
  return <div className={cn("magic-card", className)} data-slot="magic-card" {...props} />;
}
