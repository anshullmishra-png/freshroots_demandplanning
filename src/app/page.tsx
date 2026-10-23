import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/Shell";
import { demoEnabled } from "@/lib/auth/demo";
import { homeFor } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/server";

export default function Home() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GoHome />
    </Suspense>
  );
}

async function GoHome(): Promise<ReactNode> {
  const user = await getCurrentUser();
  // On an open demo preview the shared link goes straight in as Raghav. Otherwise: the sign-in page.
  redirect(user ? homeFor(user.role) : demoEnabled() ? "/api/auth/demo?role=raghav" : "/login");
}
