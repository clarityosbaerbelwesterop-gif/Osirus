import "server-only";

type LogLevel = "info" | "warn" | "error";
type SafeFields = Record<string, boolean | number | string | null | undefined>;

function emit(level: LogLevel, event: string, fields: SafeFields = {}) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.info(serialized);
}

/** Only non-secret, already-sanitized operational fields may be passed here. */
export const logger = {
  info: (event: string, fields?: SafeFields) => emit("info", event, fields),
  warn: (event: string, fields?: SafeFields) => emit("warn", event, fields),
  error: (event: string, fields?: SafeFields) => emit("error", event, fields),
};
