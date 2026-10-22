import { Card, Label } from "@/components/ui";

/** A screen that is built in a later phase of the plan. It is already behind its role check. */
export function ComingSoon({ label, title, text }: { label: string; title: string; text: string }) {
  return (
    <Card>
      <Label>{label}</Label>
      <h1 className="text-[32px] font-bold leading-tight text-sapphire">{title}</h1>
      <p className="mt-2 text-mutedtext">{text}</p>
    </Card>
  );
}
