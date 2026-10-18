'use client';
export default function GlobalError({ reset }) {
  return (
    <div className="mx-auto max-w-lg p-10 text-center">
      <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
      <p className="mt-2 text-sm text-slate-400">The page failed to load. Your data is safe.</p>
      <button onClick={reset} className="mt-4 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950">Try again</button>
    </div>
  );
}
