import Link from "next/link";

export default function ShiftsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Shifts</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/shifts" className="underline-offset-4 hover:underline">
            Schedule
          </Link>
          <Link href="/shifts/people" className="underline-offset-4 hover:underline">
            People
          </Link>
          <Link href="/" className="text-neutral-500 underline-offset-4 hover:underline">
            Synchro home
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
