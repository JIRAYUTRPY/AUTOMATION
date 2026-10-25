export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">UI Inspector &amp; Hybrid Test Platform</h1>
      <p className="mt-3 text-neutral-700">
        Milestone 1: monorepo and Docker scaffold. Project management, scanning and the test builder
        are not implemented yet.
      </p>
      <p className="mt-3 text-sm text-neutral-600">
        Service health: <code>/api/health</code>
      </p>
    </main>
  );
}
