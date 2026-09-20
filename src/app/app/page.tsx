import { bootstrapProductIdentity } from "@/lib/auth/bootstrap";
import { auth } from "@/lib/auth/server";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { ChatHub } from "@/components/chathub";
import { redirect } from "next/navigation";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const identity = await bootstrapProductIdentity({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  });
  const repository = new RuntimeRepository(identity.userId);
  const recent = await repository.getRecentWorkspaceState(identity.workspaceId);

  return (
    <>
      <ChatHub
        workspaceName={identity.workspaceName}
        initialSessionId={recent.sessionId}
        initialMessages={recent.messages}
        initialRunId={recent.activeRunId}
      />
      <form action={signOut} className="account-exit">
        <button type="submit">Sign out</button>
      </form>
    </>
  );
}
