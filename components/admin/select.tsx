import { cn } from "@/lib/utils";

/**
 * Native select styled to match the shadcn Input.
 *
 * The shadcn Select is a Radix listbox that needs client JS and a controlled
 * value; these admin forms are plain server-action forms, so a native <select>
 * is both simpler and works before hydration.
 */
export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50",
        "h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none",
        "focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}
