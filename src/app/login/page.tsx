import { Sprout } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { Card, Label, btnSecondary } from "@/components/ui";
import { demoEnabled } from "@/lib/auth/demo";

export const metadata = { title: "Sign in | Freshroots Demand Planning" };

const DEMO_ROLES = [
  { role: "raghav", label: "Raghav: plan and review" },
  { role: "procurement", label: "Procurement: orders" },
  { role: "priya", label: "Priya: enter losses" },
  { role: "deepa", label: "Deepa: operations, re-arm" },
  { role: "ceo", label: "CEO: dashboard" },
  { role: "admin", label: "Admin: users and audit" },
];

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ivory px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-sapphire text-white">
            <Sprout size={24} aria-hidden="true" />
          </span>
          <div>
            <Label>Freshroots</Label>
            <h1 className="text-2xl font-bold text-sapphire">Demand Planning</h1>
          </div>
        </div>
        {demoEnabled() && (
          <Card className="mb-6">
            <h2 className="mb-1 text-xl font-semibold text-sapphire">Open demo</h2>
            <p className="mb-4 text-sm text-mutedtext">
              A test copy with made-up data. Pick a role to look around with no password. Nothing here is real.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {DEMO_ROLES.map((r) => (
                <li key={r.role}>
                  <a href={`/api/auth/demo?role=${r.role}`} className={`${btnSecondary} w-full justify-start`}>
                    {r.label}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <h2 className="mb-4 text-xl font-semibold text-sapphire">Sign in</h2>
          <LoginForm />
        </Card>
      </div>
    </main>
  );
}
