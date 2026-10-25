"use client";

import { useActionState } from "react";
import { acceptLegalDocuments } from "./actions";
import type { LegalDocument } from "@/lib/legal/versions";

const FIELDS: {
  name: LegalDocument;
  label: string;
  href: string;
}[] = [
  { name: "terms", label: "Ich akzeptiere die AGB", href: "/legal/terms" },
  {
    name: "eula",
    label: "Ich akzeptiere die EULA",
    href: "/legal/eula",
  },
  {
    name: "privacy",
    label: "Ich habe die Datenschutzerklärung gelesen",
    href: "/legal/privacy",
  },
];

export function ConsentForm(props: {
  versions: Record<LegalDocument, string>;
}) {
  const [state, action, pending] = useActionState(acceptLegalDocuments, null);
  return (
    <form action={action}>
      {FIELDS.map((field) => (
        <label key={field.name}>
          <input name={field.name} type="checkbox" /> {field.label}{" "}
          <a href={field.href}>Text</a>
          <span className="subtle"> Fassung {props.versions[field.name]}</span>
        </label>
      ))}
      {state?.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary auth-submit"
        disabled={pending}
      >
        {pending ? "Speichern…" : "Weiter"}
      </button>
    </form>
  );
}
