"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The header links. Split out so it can also serve as the Suspense fallback. */
export function NavLinks({
  scheduleHref,
  peopleHref,
}: {
  scheduleHref: string;
  peopleHref: string;
}) {
  return (
    <nav className="flex gap-4 text-sm">
      <Link href={scheduleHref} className="underline-offset-4 hover:underline">
        Schedule
      </Link>
      <Link href={peopleHref} className="underline-offset-4 hover:underline">
        People
      </Link>
      <Link href="/" className="text-neutral-500 underline-offset-4 hover:underline">
        Synchro home
      </Link>
    </nav>
  );
}

/**
 * Header nav that keeps the week you're viewing when moving between the
 * Schedule and People pages. The week already lives in the URL —
 * `/shifts/week/<start>` for the schedule, `?week=<start>` for people — so we
 * read it from there and thread it into both links. Anywhere without a week in
 * the URL we fall back to the defaults (which open the current week).
 */
export function ShiftsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromPath = pathname.match(/^\/shifts\/week\/([^/]+)/)?.[1];
  const fromQuery = searchParams.get("week") ?? undefined;
  const week = [fromPath, fromQuery].find((w) => w && ISO_DATE.test(w));

  return (
    <NavLinks
      scheduleHref={week ? `/shifts/week/${week}` : "/shifts"}
      peopleHref={week ? `/shifts/people?week=${week}` : "/shifts/people"}
    />
  );
}
