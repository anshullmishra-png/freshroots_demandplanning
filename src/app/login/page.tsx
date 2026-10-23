import { ShieldCheck, Sprout, UserCheck, TrendingDown } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { Card, Label, btnSecondary } from "@/components/ui";
import { demoEnabled } from "@/lib/auth/demo";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { SWITCHABLE_ROLES, switchHref } from "@/lib/auth/switchable";

export const metadata = { title: "Sign in | Freshroots Demand Planning" };


const PROMISES = [
  { icon: TrendingDown, title: "Fewer stockouts and overstocks", text: "Forecasts each SKU and flags the ones about to run short or pile up, in plain rules anyone can check." },
  { icon: UserCheck, title: "A person approves every decision", text: "The AI only recommends. Raghav accepts or rejects each one, and every choice is recorded." },
  { icon: ShieldCheck, title: "Safety switches that stop it", text: "If the AI is overruled too often, or quarterly loss passes the limit, the automation stops by itself." },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-ivory lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="flex flex-col justify-between gap-10 bg-sapphire px-6 py-10 text-white md:px-12 lg:py-14">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-btn bg-gold text-sapphire">
            <Sprout size={26} aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-xl font-bold">Freshroots</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">Demand planning</p>
          </div>
        </div>
        <div>
          <h1 className="max-w-lg text-[32px] font-bold leading-tight tracking-tight md:text-[40px]">Buy the right stock, a week earlier, with a person always in charge.</h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-white/80">
            Freshroots&apos; quarterly stockout and overstock loss was Rs 28 to 34 lakh. This app is built to keep it below that, safely.
          </p>
        </div>
        <ul className="hidden gap-4 lg:grid">
          {PROMISES.map((p) => (
            <li key={p.title} className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10" aria-hidden="true">
                <p.icon size={20} />
              </span>
              <span>
                <span className="block font-semibold">{p.title}</span>
                <span className="block text-sm leading-6 text-white/75">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex items-center justify-center px-4 py-10 md:px-10">
        <div className="w-full max-w-md">
          {demoEnabled() && (
            <Card className="mb-6">
              <Label>Quick access</Label>
              <h2 className="mb-1 text-lg font-semibold text-sapphire">Continue as</h2>
              <p className="mb-4 text-sm text-mutedtext">Choose a role to open its workspace.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {SWITCHABLE_ROLES.map(({ role, name }) => (
                  <li key={role}>
                    <a href={switchHref(role)} className={`${btnSecondary} w-full flex-col items-start gap-0 py-2 text-left leading-tight`}>
                      <span>{name}</span>
                      <span className="text-xs font-semibold text-mutedtext">{ROLE_LABELS[role]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h2 className="mb-1 text-lg font-semibold text-sapphire">Sign in</h2>
            <p className="mb-4 text-sm text-mutedtext">Use the email and password you were given.</p>
            <LoginForm />
          </Card>
        </div>
      </section>
    </main>
  );
}
