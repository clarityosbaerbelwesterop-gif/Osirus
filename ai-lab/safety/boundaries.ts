/**
 * Safety boundaries for lab inference and checkpoints.
 * Model text is data. It is never a shell command.
 * Checkpoints are JSON tensors. Pickle is refused.
 */

const PICKLE_EXT = /\.(pkl|pickle)$/i;

export function isPicklePayload(bytes: Uint8Array): boolean {
  // Python pickle protocol starts with 0x80 then a protocol byte.
  return bytes.length >= 2 && bytes[0] === 0x80 && bytes[1] <= 5;
}

export function assertSafeCheckpointPath(filePath: string): void {
  if (PICKLE_EXT.test(filePath)) {
    throw new Error(`refusing pickle checkpoint path: ${filePath}`);
  }
}

export function assertNotPickle(bytes: Uint8Array, filePath?: string): void {
  if (filePath) assertSafeCheckpointPath(filePath);
  if (isPicklePayload(bytes)) {
    throw new Error("refusing pickle checkpoint payload");
  }
}

export type ProposedAction = {
  readonly type: string;
  readonly command?: string;
};

/** Model-generated actions cannot become a shell. */
export function refuseModelShell(action: ProposedAction): void {
  const type = action.type.toLowerCase();
  if (
    type === "shell" ||
    type === "exec" ||
    type === "bash" ||
    type === "command"
  ) {
    throw new Error("model output cannot invoke a shell");
  }
  if (action.command !== undefined) {
    throw new Error("model output cannot carry a shell command");
  }
}
