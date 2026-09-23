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
export const loadProductSession = cache(
  async (): Promise<ProductSession | null> => {
    requireAuthConfiguration();
    const { data: session } = await auth.getSession();
    if (!session?.user) return null;
    const identity = await bootstrapProductIdentity({
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    return {
      user: {
        id: session.user.id,
        email: session.user.email ?? null,
        name: session.user.name ?? null,
      },
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
