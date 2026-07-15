import { redirect } from "next/navigation";
import { addDays, todayIso, weekStartOf } from "@/lib/shifts/week";

// Must render per-request: the redirect target depends on today's date.
export const dynamic = "force-dynamic";

/** The shifts landing page always opens the upcoming week's editor. */
export default function ShiftsPage() {
  redirect(`/shifts/week/${addDays(weekStartOf(todayIso()), 7)}`);
}
