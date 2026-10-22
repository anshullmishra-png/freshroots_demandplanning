import { NewRunForm } from "@/components/NewRunForm";
import { Protected } from "@/components/Shell";

export const metadata = { title: "New run | Freshroots Demand Planning" };

export default function NewRunPage() {
  return <Protected permission="upload_data" render={() => <NewRunForm />} />;
}
