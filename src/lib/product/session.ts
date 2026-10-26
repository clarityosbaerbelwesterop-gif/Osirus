import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  bootstrapProductIdentity,
  type ProductIdentity,
} from "../auth/bootstrap";
import { auth, requireAuthConfiguration } from "../auth/server";

export type ProductSession = {
  user: { id: string; email: string | null; name: string | null };
  identity: ProductIdentity;
};

/**
 * The signed-in person and their workspace, once per request: the layout and
 * the page share the result instead of bootstrapping twice.
 */
export const loadAuthUser = cache(async () => {
  requireAuthConfiguration();
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };
});

export const loadProductSession = cache(
  async (): Promise<ProductSession | null> => {
    const user = await loadAuthUser();
    if (!user) return null;
    const identity = await bootstrapProductIdentity({
      id: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      user,
      identity,
    };
  },
);

/** For pages: the session, or a redirect to sign-in. */
export async function requireProductSession(): Promise<ProductSession> {
  const session = await loadProductSession();
  if (!session) redirect("/auth/sign-in");
  return session;
}

export function firstName(user: ProductSession["user"]) {
  const name = user.name?.trim();
  if (name) return name.split(/\s+/)[0] ?? null;
  return null;
}
