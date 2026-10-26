import type { Route } from "next";
import { redirect } from "next/navigation";

// Work (model, reviewer and sub-agents for one task) is part of the Rouge Agent.
export default async function WorkPage() {
  redirect("/app/agent" as Route);
}
