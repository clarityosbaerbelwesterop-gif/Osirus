import "server-only";
import { queryAs } from "@/lib/db/client";
import type { ProductIdentity } from "@/lib/auth/bootstrap";

export type AgentRow = {
  id: string;
  name: string;
  system_prompt: string;
  model_id: string;
  status: "active" | "paused";
  created_at: Date | string;
};

export async function listAgents(identity: ProductIdentity) {
  return queryAs<AgentRow>(
    identity.userId,
    `select id, name, system_prompt, model_id, status, created_at
       from osirus.agents
      where workspace_id = $1::uuid
      order by created_at desc`,
    [identity.workspaceId],
  );
}

export async function createAgent(input: {
  identity: ProductIdentity;
  name: string;
  systemPrompt: string;
  modelId: string;
}) {
  const rows = await queryAs<AgentRow>(
    input.identity.userId,
    `insert into osirus.agents
       (organization_id, workspace_id, name, system_prompt, model_id, created_by)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
     returning id, name, system_prompt, model_id, status, created_at`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.name,
      input.systemPrompt,
      input.modelId,
      input.identity.userId,
    ],
  );
  return rows[0] ?? null;
}

export async function getAgent(identity: ProductIdentity, id: string) {
  const rows = await queryAs<AgentRow>(
    identity.userId,
    `select id, name, system_prompt, model_id, status, created_at
       from osirus.agents
      where id = $1::uuid and workspace_id = $2::uuid`,
    [id, identity.workspaceId],
  );
  return rows[0] ?? null;
}

export async function updateAgent(input: {
  identity: ProductIdentity;
  id: string;
  name?: string;
  systemPrompt?: string;
  modelId?: string;
  status?: "active" | "paused";
}) {
  const current = await getAgent(input.identity, input.id);
  if (!current) return null;
  const rows = await queryAs<AgentRow>(
    input.identity.userId,
    `update osirus.agents
        set name = $3,
            system_prompt = $4,
            model_id = $5,
            status = $6,
            updated_at = now()
      where id = $1::uuid and workspace_id = $2::uuid
      returning id, name, system_prompt, model_id, status, created_at`,
    [
      input.id,
      input.identity.workspaceId,
      input.name ?? current.name,
      input.systemPrompt ?? current.system_prompt,
      input.modelId ?? current.model_id,
      input.status ?? current.status,
    ],
  );
  return rows[0] ?? null;
}

export async function deleteAgent(identity: ProductIdentity, id: string) {
  const rows = await queryAs<{ id: string }>(
    identity.userId,
    `delete from osirus.agents
      where id = $1::uuid and workspace_id = $2::uuid
      returning id`,
    [id, identity.workspaceId],
  );
  return Boolean(rows[0]);
}

export async function createGroupChat(input: {
  identity: ProductIdentity;
  title: string;
  agentIds: readonly string[];
}) {
  const agents = await listAgents(input.identity);
  const allowed = new Map(agents.map((agent) => [agent.id, agent]));
  if (input.agentIds.some((id) => !allowed.has(id))) return null;
  const rows = await queryAs<{ id: string }>(
    input.identity.userId,
    `insert into osirus.group_chats
       (organization_id, workspace_id, title, created_by)
     values ($1::uuid, $2::uuid, $3, $4::uuid)
     returning id`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.title,
      input.identity.userId,
    ],
  );
  const id = rows[0]?.id;
  if (!id) return null;
  await queryAs(
    input.identity.userId,
    `insert into osirus.group_chat_members
       (organization_id, workspace_id, group_chat_id, user_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      id,
      input.identity.userId,
    ],
  );
  for (const agentId of input.agentIds) {
    await queryAs(
      input.identity.userId,
      `insert into osirus.group_chat_members
         (organization_id, workspace_id, group_chat_id, agent_id)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [input.identity.organizationId, input.identity.workspaceId, id, agentId],
    );
  }
  return { id, title: input.title };
}

export async function groupMembers(identity: ProductIdentity, groupId: string) {
  return queryAs<{
    agent_id: string | null;
    name: string | null;
    model_id: string | null;
    status: string | null;
    system_prompt: string | null;
  }>(
    identity.userId,
    `select m.agent_id, a.name, a.model_id, a.status, a.system_prompt
       from osirus.group_chat_members m
       join osirus.group_chats g on g.id = m.group_chat_id
       left join osirus.agents a on a.id = m.agent_id
      where g.id = $1::uuid and g.workspace_id = $2::uuid and m.agent_id is not null`,
    [groupId, identity.workspaceId],
  );
}

export async function insertGroupMessage(input: {
  identity: ProductIdentity;
  groupId: string;
  role: "user" | "agent";
  userId?: string | null;
  agentId?: string | null;
  content: string;
  status: "stored" | "completed" | "unavailable" | "failed";
  modelId?: string | null;
}) {
  const rows = await queryAs<{ id: string }>(
    input.identity.userId,
    `insert into osirus.group_chat_messages
       (organization_id, workspace_id, group_chat_id, author_role,
        author_user_id, agent_id, content, status, model_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::uuid, $7, $8, $9)
     returning id`,
    [
      input.identity.organizationId,
      input.identity.workspaceId,
      input.groupId,
      input.role,
      input.userId ?? null,
      input.agentId ?? null,
      input.content,
      input.status,
      input.modelId ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

export type GroupChatSummary = {
  id: string;
  title: string;
  updatedAt: string;
  members: { id: string; name: string }[];
  messageCount: number;
  last: {
    role: "user" | "agent";
    agentId: string | null;
    content: string;
  } | null;
};

type GroupChatRow = {
  id: string;
  title: string;
  last_at: string | Date;
  message_count: number | string;
  members: { id: string; name: string }[] | null;
  last_role: "user" | "agent" | null;
  last_agent: string | null;
  last_content: string | null;
};

const GROUP_SUMMARY_SQL = `
  select g.id, g.title,
         greatest(g.updated_at, coalesce(l.created_at, g.updated_at)) as last_at,
         (select count(*) from osirus.group_chat_messages c
           where c.group_chat_id = g.id) as message_count,
         coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name)
                                   order by a.name)
                     from osirus.group_chat_members m
                     join osirus.agents a on a.id = m.agent_id
                    where m.group_chat_id = g.id), '[]'::json) as members,
         l.author_role as last_role, l.agent_id as last_agent,
         l.content as last_content
    from osirus.group_chats g
    left join lateral (
      select x.author_role, x.agent_id, x.content, x.created_at
        from osirus.group_chat_messages x
       where x.group_chat_id = g.id
       order by x.created_at desc
       limit 1
    ) l on true
   where g.workspace_id = $1::uuid`;

function toGroupSummary(row: GroupChatRow): GroupChatSummary {
  return {
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.last_at).toISOString(),
    members: row.members ?? [],
    messageCount: Number(row.message_count) || 0,
    last:
      row.last_role && row.last_content
        ? {
            role: row.last_role,
            agentId: row.last_agent,
            content: row.last_content.slice(0, 200),
          }
        : null,
  };
}

/** The workspace's group chats, most recently active first. */
export async function listGroupChats(identity: ProductIdentity) {
  const rows = await queryAs<GroupChatRow>(
    identity.userId,
    `${GROUP_SUMMARY_SQL}
   order by last_at desc
   limit 100`,
    [identity.workspaceId],
  );
  return rows.map(toGroupSummary);
}

export async function getGroupChat(identity: ProductIdentity, id: string) {
  const rows = await queryAs<GroupChatRow>(
    identity.userId,
    `${GROUP_SUMMARY_SQL} and g.id = $2::uuid`,
    [identity.workspaceId, id],
  );
  return rows[0] ? toGroupSummary(rows[0]) : null;
}

export type GroupMessage = {
  id: string;
  role: "user" | "agent";
  agentId: string | null;
  content: string;
  status: "stored" | "completed" | "unavailable" | "failed";
  createdAt: string;
};

/** A group chat's messages, oldest first (the newest 300). */
export async function listGroupMessages(
  identity: ProductIdentity,
  groupId: string,
): Promise<GroupMessage[]> {
  const rows = await queryAs<{
    id: string;
    author_role: "user" | "agent";
    agent_id: string | null;
    content: string;
    status: GroupMessage["status"];
    created_at: string | Date;
  }>(
    identity.userId,
    `select * from (
       select m.id, m.author_role, m.agent_id, m.content, m.status, m.created_at
         from osirus.group_chat_messages m
         join osirus.group_chats g on g.id = m.group_chat_id
        where m.group_chat_id = $1::uuid and g.workspace_id = $2::uuid
        order by m.created_at desc
        limit 300
     ) recent order by created_at asc`,
    [groupId, identity.workspaceId],
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.author_role,
    agentId: row.agent_id,
    content: row.content,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

/** Marks a group chat as active now, for the order of the lists. */
export async function touchGroupChat(identity: ProductIdentity, id: string) {
  await queryAs(
    identity.userId,
    `update osirus.group_chats set updated_at = now()
      where id = $1::uuid and workspace_id = $2::uuid`,
    [id, identity.workspaceId],
  );
}

export type BotConversation = { id: string; title: string; updatedAt: string };

/** One bot's own conversations (chat threads its answers are in). */
export async function listBotConversations(
  identity: ProductIdentity,
  agentId: string,
): Promise<BotConversation[]> {
  const rows = await queryAs<{
    id: string;
    title: string;
    updated_at: string | Date;
  }>(
    identity.userId,
    `select s.id, s.title, s.updated_at
       from osirus.sessions s
      where s.workspace_id = $1::uuid and s.archived_at is null
        and s.surface = 'bot'
        and exists (
          select 1 from osirus.messages m
           where m.session_id = s.id and m.metadata->>'botId' = $2
        )
      order by s.updated_at desc
      limit 30`,
    [identity.workspaceId, agentId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}
