import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PageSkeleton } from "@/components/Shell";
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
  redirect(user ? homeFor(user.role) : "/login");
}
