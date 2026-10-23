/** Browser side of the resumable AI step: ask the server for the missing decisions until none remain. */
export interface ContinueState {
  runId: number;
  flagCount: number;
  remaining: number;
  status: string;
}

// Each request works for about 2.5 minutes. A run needs a handful at most; the cap only stops a runaway loop.
const MAX_REQUESTS = 20;

export async function continueUntilDone(
  runId: number,
  onProgress: (state: ContinueState) => void,
  fetcher: typeof fetch = fetch,
): Promise<ContinueState> {
  let last: ContinueState | null = null;
  let stuck = 0;
  for (let i = 0; i < MAX_REQUESTS; i++) {
    const res = await fetcher(`/api/runs/${runId}/continue`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message ?? `The AI step stopped (${res.status}). Press the button to carry on.`);
    const next = json as ContinueState;
    // Every request should finish at least one batch. Three in a row that finish none means something is wrong.
    stuck = last && next.remaining >= last.remaining ? stuck + 1 : 0;
    last = next;
    onProgress(last);
    if (last.remaining === 0) return last;
    if (stuck >= 3) throw new Error("The AI step is not making progress. Press the button to try again, or ask for help if it keeps happening.");
  }
  throw new Error("The AI step is taking longer than expected. Press the button to carry on.");
}
