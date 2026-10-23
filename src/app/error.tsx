"use client";

import { btnPrimary } from "@/components/ui";

/** Anything that goes wrong while drawing a page lands here: a plain message and a way to try again. No details leak. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext">Freshroots</p>
      <h1 className="text-[32px] font-bold leading-tight text-sapphire">Something went wrong</h1>
      <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
        This page could not be shown. Nothing was changed. Try again, and if it keeps happening tell the person who runs the system.
      </p>
      <div>
        <button type="button" className={btnPrimary} onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
