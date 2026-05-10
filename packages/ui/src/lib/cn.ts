/**
 * cn — className helper
 *
 * 合并 clsx（条件类名）与 tailwind-merge（冲突去重）。
 * 所有组件使用 `cn(base, variants, className)` 组合类名。
 *
 * Combine clsx (conditional class names) with tailwind-merge (conflict
 * deduplication). All components use `cn(base, variants, className)`.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
