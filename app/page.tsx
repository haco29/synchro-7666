import Link from "next/link";

const FEATURES = [
  {
    href: "/shifts",
    title: "Shifts",
    description:
      "Weekly shift scheduling — roster, availability, fair auto-assignment, and a shareable schedule link.",
    ready: true,
  },
  {
    href: "#",
    title: "More coming",
    description: "Synchro will grow — new coordination tools land here.",
    ready: false,
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-semibold">Synchro</h1>
      <p className="mb-8 text-neutral-500">Keep your team in sync.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) =>
          f.ready ? (
            <Link
              key={f.title}
              href={f.href}
              className="rounded-lg border border-neutral-200 p-5 transition hover:border-neutral-400 hover:shadow-sm dark:border-neutral-800 dark:hover:border-neutral-600"
            >
              <h2 className="mb-1 text-lg font-medium">{f.title}</h2>
              <p className="text-sm text-neutral-500">{f.description}</p>
            </Link>
          ) : (
            <div
              key={f.title}
              className="rounded-lg border border-dashed border-neutral-200 p-5 opacity-60 dark:border-neutral-800"
            >
              <h2 className="mb-1 text-lg font-medium">{f.title}</h2>
              <p className="text-sm text-neutral-500">{f.description}</p>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
