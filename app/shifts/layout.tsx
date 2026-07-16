import { Suspense } from "react";
import { NavLinks, ShiftsNav } from "./_components/shifts-nav";

export default function ShiftsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Shifts</h1>
        <Suspense fallback={<NavLinks scheduleHref="/shifts" peopleHref="/shifts/people" />}>
          <ShiftsNav />
        </Suspense>
      </header>
      {children}
    </div>
  );
}
