import { Sprout } from "lucide-react";
import { LoginForm } from "@/components/LoginForm";
import { Card, Label } from "@/components/ui";

export const metadata = { title: "Sign in | Freshroots Demand Planning" };

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
        <Card>
          <h2 className="mb-4 text-xl font-semibold text-sapphire">Sign in</h2>
          <LoginForm />
        </Card>
      </div>
    </main>
  );
}
