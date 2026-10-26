import type { Route } from "next";
import { redirect } from "next/navigation";

// Bot chats live in Agents now: the bot is picked in the chat itself.
export default async function BotsPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  redirect(
    (session ? `/app?session=${encodeURIComponent(session)}` : "/app") as Route,
  );
}
