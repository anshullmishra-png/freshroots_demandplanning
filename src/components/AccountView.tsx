import { SignOutButton } from "@/components/SignOutButton";
import { RoleList } from "@/components/RoleSwitcher";
import { Card, Label } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";

/** Who is signed in, and the way out. Pure, so the browser checks render the same thing. */
export function AccountView({ user, switchRoles = false }: { user: { name: string; email: string; role: Role }; switchRoles?: boolean }) {
  return (
    <div className="flex max-w-xl flex-col gap-8">
      <div>
        <Label>Account</Label>
        <h1 className="text-[32px] font-bold leading-tight text-sapphire">{user.name}</h1>
      </div>
      <Card>
        <dl className="divide-y divide-border text-sm">
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-mutedtext">Email</dt>
            <dd className="break-all font-semibold text-sapphire">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-mutedtext">Role</dt>
            <dd className="font-semibold text-sapphire">{ROLE_LABELS[user.role]}</dd>
          </div>
        </dl>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </Card>
      {switchRoles && (
        <Card>
          <Label>Switch role</Label>
          <p className="mb-3 mt-1 text-sm text-mutedtext">Open another person&apos;s workspace without signing out.</p>
          <RoleList current={user.role} />
        </Card>
      )}
    </div>
  );
}
