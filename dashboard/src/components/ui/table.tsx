import { type ComponentProps } from "react";
import { cn } from "../../lib/utils";

interface TableProps extends ComponentProps<"table"> {}

export function Table({ className, ...props }: TableProps) {
  return <table className={cn("ui-table", className)} data-slot="table" {...props} />;
}

interface TableHeaderProps extends ComponentProps<"thead"> {}

export function TableHeader({ className, ...props }: TableHeaderProps) {
  return <thead className={cn("ui-table-header", className)} data-slot="table-header" {...props} />;
}

interface TableBodyProps extends ComponentProps<"tbody"> {}

export function TableBody({ className, ...props }: TableBodyProps) {
  return <tbody className={cn("ui-table-body", className)} data-slot="table-body" {...props} />;
}

interface TableRowProps extends ComponentProps<"tr"> {}

export function TableRow({ className, ...props }: TableRowProps) {
  return <tr className={cn("ui-table-row", className)} data-slot="table-row" {...props} />;
}

interface TableHeadProps extends ComponentProps<"th"> {}

export function TableHead({ className, ...props }: TableHeadProps) {
  return <th className={cn("ui-table-head", className)} data-slot="table-head" {...props} />;
}

interface TableCellProps extends ComponentProps<"td"> {}

export function TableCell({ className, ...props }: TableCellProps) {
  return <td className={cn("ui-table-cell", className)} data-slot="table-cell" {...props} />;
}
