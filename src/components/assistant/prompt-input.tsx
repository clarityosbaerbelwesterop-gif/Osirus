"use client";

import {
  type FormEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

/**
 * Prompt input composition.
 * Structure follows Nexus UI PromptInput (MIT),
 * https://github.com/victorcodess/nexus-ui
 * and assistant-ui Composer (MIT),
 * https://github.com/assistant-ui/assistant-ui
 * Original markup and Osirus CSS. No copied source, no logos.
 */

export function PromptInput(props: {
  onSubmit: () => void;
  children: ReactNode;
  label?: string;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <form className="prompt-input" onSubmit={submit} aria-label={props.label}>
      {props.children}
    </form>
  );
}

export function PromptInputTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return <textarea className="prompt-textarea" rows={4} {...props} />;
}

export function PromptInputActions(props: { children: ReactNode }) {
  return <div className="prompt-actions">{props.children}</div>;
}
