"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";

/** The name Osirus greets you with; stored in the sign-in profile. */
export function ProfileName(props: { name: string | null }) {
  const router = useRouter();
  const [name, setName] = useState(props.name ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const trimmed = name.trim();
  const changed = trimmed !== (props.name ?? "").trim();

  const save = async () => {
    if (!trimmed || !changed) return;
    setState("saving");
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result?.error) throw new Error(result.error.message ?? "failed");
      setState("saved");
      router.refresh();
    } catch {
      setState("error");
    }
  };

  return (
    <form
      className="profile-name"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="Dein Name"
        value={name}
        maxLength={80}
        autoComplete="name"
        onChange={(event) => {
          setName(event.target.value);
          setState("idle");
        }}
      />
      <button
        type="submit"
        className="btn btn-secondary"
        disabled={!trimmed || !changed || state === "saving"}
      >
        {state === "saving" ? "Speichert…" : "Speichern"}
      </button>
      <span className="subtle" role="status" aria-live="polite">
        {state === "saved"
          ? "Gespeichert."
          : state === "error"
            ? "Konnte nicht gespeichert werden. Bitte erneut versuchen."
            : ""}
      </span>
    </form>
  );
}
