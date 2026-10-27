import { notFound } from "next/navigation";
import { GroupRoom } from "@/components/bots/group-room";
import { getGroupChat, listGroupMessages } from "@/lib/agents/store";
import { isUuid } from "@/lib/gateway/threads";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";

/** A group chat with its whole thread, loaded from the server. */
export default async function GroupChatPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  if (!isUuid(groupId)) notFound();
  const { identity } = await requireProductSession();
  const [group, messages] = await Promise.all([
    getGroupChat(identity, groupId),
    listGroupMessages(identity, groupId).catch(() => []),
  ]);
  if (!group) notFound();
  return (
    <GroupRoom
      key={group.id}
      group={{ id: group.id, title: group.title, members: group.members }}
      initialMessages={messages}
    />
  );
}
