"use server";

import { auth, requireAuthConfiguration } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { markTourSeen } from "@/lib/product/onboarding";
import { loadAuthUser } from "@/lib/product/session";

export async function signOut() {
  requireAuthConfiguration();
  await auth.signOut();
  redirect("/auth/sign-in");
}

/** The introduction tour was finished or skipped: do not open it again. */
export async function completeTour() {
  try {
    const user = await loadAuthUser();
    if (user) await markTourSeen(user.id);
  } catch (error) {
    // Not recorded: the tour opens once more on the next visit.
    console.warn(
      "tour.record_failed",
      error instanceof Error ? error.message : error,
    );
  }
}
