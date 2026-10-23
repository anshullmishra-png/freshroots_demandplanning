import type { Role } from "./permissions";

/** The people in the workspace and the order they are listed in. Pure data: the browser may import it. */
export const SWITCHABLE_ROLES: Array<{ role: Role; name: string }> = [
  { role: "raghav", name: "Raghav" },
  { role: "procurement", name: "Procurement Team" },
  { role: "priya", name: "Priya" },
  { role: "deepa", name: "Deepa" },
  { role: "ceo", name: "CEO" },
  { role: "admin", name: "Admin" },
];

/** Switching signs in as that role and lands on its home page (the same address the sign-in page uses). */
export const switchHref = (role: Role) => `/api/auth/demo?role=${role}`;
