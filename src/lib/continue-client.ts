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
  for (let i = 0; i < MAX_REQUESTS; i++) {
    const res = await fetcher(`/api/runs/${runId}/continue`, { method: "POST" });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error?.message ?? `The AI step stopped (${res.status}). Press the button to carry on.`);
    last = json as ContinueState;
    onProgress(last);
    if (last.remaining === 0) return last;
  }
  throw new Error("The AI step is taking longer than expected. Press the button to carry on.");
}
