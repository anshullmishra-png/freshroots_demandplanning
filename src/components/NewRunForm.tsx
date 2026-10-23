"use client";

import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";
import { Card, CardHeader, Label, btnPrimary, btnSecondary, cx } from "@/components/ui";
import { continueUntilDone } from "@/lib/continue-client";

type FileKey = "sales" | "inventory" | "sku_master" | "distributor_master" | "calendar";

const SLOTS: Array<{ key: FileKey; label: string; name: string; master: boolean }> = [
  { key: "sales", label: "Weekly sales", name: "weekly_sales.csv", master: false },
  { key: "inventory", label: "Current inventory", name: "current_inventory.csv", master: false },
  { key: "sku_master", label: "SKU master", name: "sku_master.csv", master: true },
  { key: "distributor_master", label: "Distributor master", name: "distributor_master.csv", master: true },
  { key: "calendar", label: "Calendar", name: "calendar.csv", master: true },
];

interface Issue {
  level: "ERROR" | "WARNING";
  file: FileKey;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
}
interface Report {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  fileStats: Record<FileKey, number | null>;
}

const STEPS = ["Upload", "Validate", "Forecast and flag", "AI decisions", "Review", "Buying decision"];

export function NewRunForm({ blockedReason = null }: { blockedReason?: string | null }) {
  const router = useRouter();
  const [files, setFiles] = useState<Partial<Record<FileKey, File>>>({});
  const [usePrevious, setUsePrevious] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"validate" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const required = SLOTS.filter((s) => !(usePrevious && s.master));
  const blocked = blockedReason !== null;
  const haveAll = required.every((s) => files[s.key]);

  function build(extra: Record<string, string> = {}) {
    const form = new FormData();
    for (const s of SLOTS) {
      const f = files[s.key];
      if (f) form.append(s.key, f);
    }
    if (usePrevious) form.append("usePreviousMasters", "true");
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return form;
  }

  function pick(key: FileKey) {
    return (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      setFiles((cur) => ({ ...cur, [key]: f }));
      setReport(null);
      setAcknowledged(false);
      setError(null);
    };
  }

  async function validate() {
    setBusy("validate");
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/runs/validate", { method: "POST", body: build() });
      const json = await res.json();
      if (!res.ok) setError(json?.error?.message ?? `Could not check the files (${res.status}).`);
      else setReport(json as Report);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("run");
    setError(null);
    try {
      const res = await fetch("/api/runs", { method: "POST", body: build({ acknowledgeWarnings: String(acknowledged) }) });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? `The run did not start (${res.status}).`);
        setBusy(null);
        return;
      }
      setProgress({ done: json.flagCount - json.remaining, total: json.flagCount });
      // One request works for about 2.5 minutes. If decisions are still missing, ask for them until none remain.
      if (json.remaining > 0) {
        try {
          await continueUntilDone(json.runId, (s) => setProgress({ done: s.flagCount - s.remaining, total: s.flagCount }));
        } catch (e) {
          // Nothing is lost: the run is saved. Raghav can carry on from the Review page.
          setError(`${e instanceof Error ? e.message : "The AI step stopped."} The run is saved; carry on from the Review page.`);
          setBusy(null);
          router.push(`/review?run=${json.runId}`);
          return;
        }
      }
      router.push(`/review?run=${json.runId}`);
    } catch {
      setError("Could not reach the server. If the run was created, find it on the Review page.");
      setBusy(null);
    }
  }

  const hasWarnings = (report?.warnings.length ?? 0) > 0;
  const canStart = !blocked && !!report?.ok && (!hasWarnings || acknowledged) && busy === null;
  const step = busy === "run" ? 2 : report?.ok ? 2 : haveAll ? 1 : 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-8">
        <div>
          <Label>New run</Label>
          <h1 className="text-[32px] font-bold leading-tight text-sapphire">Upload this week&apos;s SAP files</h1>
        </div>

        {blockedReason && (
          <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
            {blockedReason}
          </p>
        )}

        <Card>
          <CardHeader title="Files" />
          <label className="mb-4 flex min-h-[44px] items-center gap-3 text-sm font-semibold text-sapphire">
            <input
              type="checkbox"
              className="h-5 w-5 accent-sapphire"
              checked={usePrevious}
              onChange={(e) => {
                setUsePrevious(e.target.checked);
                setReport(null);
              }}
            />
            Use previous master files (SKU master, distributor master, calendar)
          </label>
          <ul className="divide-y divide-border">
            {SLOTS.map((s) => {
              const skipped = usePrevious && s.master;
              const f = files[s.key];
              return (
                <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-bold text-sapphire">{s.label}</p>
                    <p className="text-xs text-mutedtext">
                      {skipped
                        ? "Using the previous upload"
                        : f
                          ? `${f.name} · ${(f.size / 1024).toFixed(1)} KB${report?.fileStats[s.key] != null ? ` · ${report.fileStats[s.key]} rows` : ""}`
                          : `Expected ${s.name}`}
                    </p>
                  </div>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    aria-label={`${s.label} file`}
                    disabled={skipped}
                    onChange={pick(s.key)}
                    className="max-w-full text-sm text-sapphire file:mr-3 file:min-h-[44px] file:rounded-btn file:border-2 file:border-sapphire file:bg-transparent file:px-4 file:font-bold file:text-sapphire"
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={btnSecondary} disabled={blocked || !haveAll || busy !== null} onClick={validate}>
              {busy === "validate" ? "Checking..." : "Check files"}
            </button>
          </div>
        </Card>

        {error && (
          <p role="alert" className="rounded-btn bg-dangermutedbg px-4 py-3 text-sm font-semibold text-dangermuted">
            {error}
          </p>
        )}

        {report && (
          <Card>
            <CardHeader title="Validation report" />
            {report.errors.length === 0 ? (
              <p className="rounded-btn bg-emerald/15 px-3 py-2 text-sm font-semibold text-sapphire">No errors. The files can be used.</p>
            ) : (
              <IssueList title={`${report.errors.length} error(s): the run is blocked`} issues={report.errors} tone="error" />
            )}
            {report.warnings.length > 0 && (
              <div className="mt-4">
                <IssueList title={`${report.warnings.length} warning(s)`} issues={report.warnings} tone="warning" />
                {report.ok && (
                  <label className="mt-3 flex min-h-[44px] items-center gap-3 text-sm font-semibold text-sapphire">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-sapphire"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                    />
                    I have read the warnings
                  </label>
                )}
              </div>
            )}
            <div className="mt-4">
              <button type="button" className={btnPrimary} disabled={!canStart} onClick={start}>
                {busy === "run" ? "Running... this can take a few minutes" : "Start run"}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              {busy === "run" && progress && (
                <p role="status" className="mt-3 text-sm font-semibold text-sapphire">
                  AI decisions: {progress.done} of {progress.total}. Keep this page open.
                </p>
              )}
            </div>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader title="Pipeline" />
        <ol className="relative">
          {STEPS.map((title, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={title} className="relative flex gap-3 pb-6 last:pb-0">
                {i < STEPS.length - 1 && (
                  <span className={cx("absolute left-[7px] top-4 h-full w-0.5", done ? "bg-emerald" : "bg-track")} aria-hidden="true" />
                )}
                <span
                  className={cx(
                    "relative z-[1] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white",
                    done ? "bg-emerald" : active ? "bg-gold ring-4 ring-gold/30" : "bg-track",
                  )}
                  aria-hidden="true"
                >
                  {done && <Check size={10} strokeWidth={4} />}
                  {active && <ArrowRight size={10} strokeWidth={3} className="text-sapphire" />}
                </span>
                <div>
                  <p className="text-sm font-bold text-sapphire">{title}</p>
                  <p className="text-[10px] text-mutedtext">{done ? "Done" : active ? "Now" : "Waiting"}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function IssueList({ title, issues, tone }: { title: string; issues: Issue[]; tone: "error" | "warning" }) {
  return (
    <div>
      <p className={cx("mb-2 text-sm font-bold", tone === "error" ? "text-dangermuted" : "text-sapphire")}>{title}</p>
      <ul className="divide-y divide-border rounded-box border border-border">
        {issues.map((i, n) => (
          <li key={n} className={cx("px-3 py-2 text-sm", tone === "error" ? "bg-dangermutedbg/50" : "bg-gold/10")}>
            <span className="font-bold text-sapphire">
              {i.file}
              {i.row ? ` line ${i.row}` : ""}
            </span>{" "}
            <span className="text-sapphire">{i.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
