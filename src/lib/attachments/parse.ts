// What an uploaded file is, and what Osirus can read out of it.
//
// The type comes from the bytes first (PDF and image signatures, valid
// UTF-8 text) and the file name second; a file that is neither a known
// binary format nor text is refused, whatever its name says. Parsing turns
// the file into plain text plus a little structure (CSV columns, JSON shape,
// PDF pages) and then into chunks of at most 1,500 characters, each with a
// locator, so a run can retrieve the relevant parts rather than the whole
// document.

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 2_000_000;
const CHUNK = 1_500;

export type AttachmentKind =
  "text" | "markdown" | "json" | "csv" | "pdf" | "image" | "code";

export type Inspection =
  | { ok: true; kind: AttachmentKind; mediaType: string }
  | { ok: false; error: "empty" | "too_large" | "unsupported_type" };

const CODE_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|swift|sql|sh|yaml|yml|toml|css|scss|html|xml)$/i;

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function isUtf8Text(bytes: Uint8Array): boolean {
  try {
    // stream: a multi-byte character cut at the sample boundary is buffered,
    // not reported as invalid.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, Math.min(bytes.length, 64 * 1024)),
      { stream: true },
    );
    // Control characters other than whitespace mean binary.
    return !/[\u0000-\u0008\u000e-\u001f]/.test(text);
  } catch {
    return false;
  }
}

export function inspectAttachment(
  filename: string,
  bytes: Uint8Array,
): Inspection {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    return { ok: false, error: "too_large" };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { ok: true, kind: "pdf", mediaType: "application/pdf" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]))
    return { ok: true, kind: "image", mediaType: "image/png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return { ok: true, kind: "image", mediaType: "image/jpeg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { ok: true, kind: "image", mediaType: "image/gif" };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return { ok: true, kind: "image", mediaType: "image/webp" };
  if (!isUtf8Text(bytes)) return { ok: false, error: "unsupported_type" };
  const name = filename.toLowerCase();
  if (name.endsWith(".json"))
    return { ok: true, kind: "json", mediaType: "application/json" };
  if (name.endsWith(".csv") || name.endsWith(".tsv"))
    return { ok: true, kind: "csv", mediaType: "text/csv" };
  if (name.endsWith(".md") || name.endsWith(".markdown"))
    return { ok: true, kind: "markdown", mediaType: "text/markdown" };
  if (CODE_EXTENSIONS.test(name))
    return { ok: true, kind: "code", mediaType: "text/plain" };
  return { ok: true, kind: "text", mediaType: "text/plain" };
}

export type Parsed = {
  status: "parsed" | "unsupported" | "failed";
  text: string | null;
  structure: Record<string, unknown>;
  chunks: Array<{ content: string; locator: string }>;
  error?: string;
};

/** Split on paragraph, then line, then hard boundaries, never over CHUNK. */
export function chunkText(text: string, locatorOf: (index: number) => string) {
  const chunks: Array<{ content: string; locator: string }> = [];
  let current = "";
  const flush = () => {
    const content = current.trim();
    if (content) chunks.push({ content, locator: locatorOf(chunks.length) });
    current = "";
  };
  for (const block of text.split(/\n{2,}/)) {
    const pieces =
      block.length > CHUNK
        ? (block.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, "g")) ?? [])
        : [block];
    for (const piece of pieces) {
      if (current.length + piece.length + 2 > CHUNK) flush();
      current += (current ? "\n\n" : "") + piece;
    }
  }
  flush();
  return chunks.slice(0, 2_000);
}

function parseCsv(text: string) {
  const delimiter = (text.split("\n")[0] ?? "").includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

export async function parseAttachment(
  kind: AttachmentKind,
  bytes: Uint8Array,
): Promise<Parsed> {
  if (kind === "image")
    return {
      status: "unsupported",
      text: null,
      structure: {},
      chunks: [],
      error:
        "Stored. The configured model does not read images, so its content is not used.",
    };
  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { totalPages, text } = await extractText(pdf, {
        mergePages: false,
      });
      const pages = (text as string[]).map((page) => page.trim());
      const chunks: Parsed["chunks"] = [];
      pages.forEach((page, index) => {
        for (const chunk of chunkText(page, () => `page ${index + 1}`))
          chunks.push(chunk);
      });
      const joined = pages.join("\n\n").slice(0, MAX_TEXT);
      return {
        status: joined.trim() ? "parsed" : "unsupported",
        text: joined || null,
        structure: { pages: totalPages },
        chunks: chunks.slice(0, 2_000),
        ...(joined.trim()
          ? {}
          : { error: "The PDF has no extractable text (a scan?)." }),
      };
    }
    const text = new TextDecoder("utf-8").decode(bytes).slice(0, MAX_TEXT);
    if (kind === "json") {
      const value = JSON.parse(text) as unknown;
      const shape = Array.isArray(value)
        ? { type: "array", length: value.length }
        : value && typeof value === "object"
          ? { type: "object", keys: Object.keys(value).slice(0, 50) }
          : { type: typeof value };
      return {
        status: "parsed",
        text,
        structure: shape,
        chunks: chunkText(text, (index) => `part ${index + 1}`),
      };
    }
    if (kind === "csv") {
      const rows = parseCsv(text);
      const [header = [], ...body] = rows;
      const rowChunks: Parsed["chunks"] = [];
      for (let start = 0; start < body.length; start += 40) {
        const slice = body.slice(start, start + 40);
        const content = [header, ...slice]
          .map((entry) => entry.join(","))
          .join("\n")
          .slice(0, CHUNK * 2 - 1);
        rowChunks.push({
          content: content.slice(0, 3_999),
          locator: `rows ${start + 1}-${start + slice.length}`,
        });
      }
      return {
        status: "parsed",
        text,
        structure: { columns: header.slice(0, 100), rows: body.length },
        chunks: rowChunks.slice(0, 2_000),
      };
    }
    return {
      status: "parsed",
      text,
      structure: { lines: text.split("\n").length },
      chunks: chunkText(text, (index) => `part ${index + 1}`),
    };
  } catch (error) {
    return {
      status: "failed",
      text: null,
      structure: {},
      chunks: [],
      error:
        kind === "json"
          ? "The file is not valid JSON."
          : error instanceof Error
            ? error.message.slice(0, 200)
            : "The file could not be read.",
    };
  }
}
