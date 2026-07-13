import Link from "next/link";
import { addDays, dayLabel } from "@/lib/shifts/week";

/** Header row with prev/next week arrows linking to `hrefFor(weekStart)`. */
export function WeekNav({
  weekStart,
  hrefFor,
}: {
  weekStart: string;
  hrefFor: (weekStart: string) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Link
        href={hrefFor(addDays(weekStart, -7))}
        aria-label="Previous week"
        className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        ←
      </Link>
      <span className="min-w-48 text-center font-medium">
        Week of {dayLabel(weekStart)} – {dayLabel(addDays(weekStart, 6))}
      </span>
      <Link
        href={hrefFor(addDays(weekStart, 7))}
        aria-label="Next week"
        className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        →
      </Link>
    </div>
  );
}
