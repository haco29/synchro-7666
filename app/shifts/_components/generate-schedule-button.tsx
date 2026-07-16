"use client";

import { generateWeekAction } from "../actions";

/**
 * Generate / Regenerate the week's schedule. Since there is no publish gate,
 * regenerating overwrites live assignments (including manual edits) — so when a
 * schedule already exists we require an explicit confirm. First-time generation
 * (an empty week) has nothing to clobber and submits straight through.
 */
export function GenerateScheduleButton({
  weekStart,
  isRegenerate,
}: {
  weekStart: string;
  isRegenerate: boolean;
}) {
  return (
    <form
      action={generateWeekAction}
      onSubmit={(e) => {
        if (
          isRegenerate &&
          !window.confirm(
            "Regenerate the schedule? This overwrites all assignments for this week, including manual edits.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="weekStart" value={weekStart} />
      <button
        type="submit"
        className="rounded bg-neutral-900 px-4 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
      >
        {isRegenerate ? "Regenerate" : "Generate"} schedule
      </button>
    </form>
  );
}
