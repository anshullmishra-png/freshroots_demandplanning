import Link from "next/link";
import { btnPrimary } from "@/components/ui";

export const metadata = { title: "Page not found | Freshroots Demand Planning" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-mutedtext">Freshroots</p>
      <h1 className="text-[32px] font-bold leading-tight text-sapphire">That page does not exist</h1>
      <p className="text-mutedtext">The link may be old or mistyped.</p>
      <div>
        <Link href="/" className={btnPrimary}>
          Go to my home page
        </Link>
      </div>
    </main>
  );
}
