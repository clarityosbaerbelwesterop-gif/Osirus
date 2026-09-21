"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";

export async function signOut() {
  requireAuthConfiguration();
  await auth.signOut();
  redirect("/auth/sign-in");
}
