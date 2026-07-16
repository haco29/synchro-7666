import { redirect } from "next/navigation";
import { todayIso, weekStartOf } from "@/lib/shifts/week";

// Must render per-request: the redirect target depends on today's date.
export const dynamic = "force-dynamic";

/** The shifts landing page always opens the current week's editor. */
export default function ShiftsPage() {
  redirect(`/shifts/week/${weekStartOf(todayIso())}`);
}
