import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface CardProps extends ComponentProps<"section"> {}

export function Card({ className, ...props }: CardProps) {
  return <section className={cn("ui-card", className)} data-slot="card" {...props} />;
}

interface CardHeaderProps extends ComponentProps<"div"> {}

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div className={cn("ui-card-header", className)} data-slot="card-header" {...props} />;
}

interface CardContentProps extends ComponentProps<"div"> {}

export function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cn("ui-card-content", className)} data-slot="card-content" {...props} />;
}

interface CardTitleProps extends ComponentProps<"h2"> {
  level?: 1 | 2 | 3;
}

export function CardTitle({ className, level = 2, ...props }: CardTitleProps) {
  const Heading = `h${level}` as "h1" | "h2" | "h3";
  return <Heading className={cn("ui-card-title", className)} data-slot="card-title" {...props} />;
}

interface CardDescriptionProps extends ComponentProps<"p"> {}

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <p className={cn("ui-card-description", className)} data-slot="card-description" {...props} />
  );
}
