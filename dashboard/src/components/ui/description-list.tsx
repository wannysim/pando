import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface DescriptionListProps extends ComponentProps<"dl"> {}

export function DescriptionList({ className, ...props }: DescriptionListProps) {
  return (
    <dl className={cn("ui-description-list", className)} data-slot="description-list" {...props} />
  );
}

interface DescriptionItemProps extends ComponentProps<"div"> {}

export function DescriptionItem({ className, ...props }: DescriptionItemProps) {
  return (
    <div className={cn("ui-description-item", className)} data-slot="description-item" {...props} />
  );
}

interface DescriptionTermProps extends ComponentProps<"dt"> {}

export function DescriptionTerm({ className, ...props }: DescriptionTermProps) {
  return (
    <dt className={cn("ui-description-term", className)} data-slot="description-term" {...props} />
  );
}

interface DescriptionDetailsProps extends ComponentProps<"dd"> {}

export function DescriptionDetails({ className, ...props }: DescriptionDetailsProps) {
  return (
    <dd
      className={cn("ui-description-details", className)}
      data-slot="description-details"
      {...props}
    />
  );
}
