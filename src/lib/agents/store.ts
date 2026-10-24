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
