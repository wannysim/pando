import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface TabsListProps extends ComponentProps<"div"> {}

export function TabsList({ className, ...props }: TabsListProps) {
  return <div className={cn("ui-tabs-list", className)} data-slot="tabs-list" {...props} />;
}

interface TabsTriggerProps extends ComponentProps<"button"> {
  active?: boolean;
}

export function TabsTrigger({ active = false, className, ...props }: TabsTriggerProps) {
  return (
    <button
      className={cn("ui-tabs-trigger", active && "ui-tabs-trigger--active", className)}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}
