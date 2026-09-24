import { describe, expect, it } from "vitest";
import {
  chunkText,
  inspectAttachment,
  MAX_ATTACHMENT_BYTES,
  parseAttachment,
} from "../src/lib/attachments/parse";

const bytes = (text: string) => new TextEncoder().encode(text);

/** A one-page PDF with one line of text, built by hand with a valid xref. */
function tinyPdf(text: string) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 18 Tf 20 100 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 18 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}

describe("attachment inspection", () => {
  it("decides the type from the bytes, not the name", () => {
    expect(inspectAttachment("report.txt", tinyPdf("x"))).toMatchObject({
      ok: true,
      kind: "pdf",
    });
    expect(
      inspectAttachment(
        "photo.csv",
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]),
      ),
    ).toMatchObject({ ok: true, kind: "image", mediaType: "image/png" });
    expect(inspectAttachment("data.csv", bytes("a,b\n1,2\n"))).toMatchObject({
      kind: "csv",
    });
    expect(
      inspectAttachment("app.ts", bytes("export const a = 1;")),
    ).toMatchObject({ kind: "code" });
    // Binary that is neither a known format nor text is refused.
    expect(
      inspectAttachment(
        "tool.txt",
        new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2]),
      ),
    ).toEqual({ ok: false, error: "unsupported_type" });
    expect(inspectAttachment("a.txt", new Uint8Array())).toEqual({
      ok: false,
      error: "empty",
    });
    expect(
      inspectAttachment("big.txt", new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
    ).toEqual({ ok: false, error: "too_large" });
  });
});

describe("attachment parsing", () => {
  it("reads CSV columns and chunks rows with their locators", async () => {
    const rows = Array.from({ length: 95 }, (_, i) => `m${i},${i * 10}`);
    const parsed = await parseAttachment(
      "csv",
      bytes(`month,"revenue, EUR"\n${rows.join("\n")}\n`),
    );
    expect(parsed.status).toBe("parsed");
    expect(parsed.structure).toEqual({
      columns: ["month", "revenue, EUR"],
      rows: 95,
    });
    expect(parsed.chunks.map((chunk) => chunk.locator)).toEqual([
      "rows 1-40",
      "rows 41-80",
      "rows 81-95",
    ]);
    // Every chunk repeats the header so it stands on its own.
    expect(parsed.chunks[2]!.content.startsWith("month,revenue, EUR")).toBe(
      true,
    );
  });

  it("describes JSON and rejects invalid JSON honestly", async () => {
    const ok = await parseAttachment("json", bytes('{"a":1,"b":[1,2]}'));
    expect(ok.structure).toEqual({ type: "object", keys: ["a", "b"] });
    const bad = await parseAttachment("json", bytes("{nope"));
    expect(bad).toMatchObject({
      status: "failed",
      error: "The file is not valid JSON.",
    });
  });

  it("extracts PDF text per page", async () => {
    const parsed = await parseAttachment(
      "pdf",
      tinyPdf("Quarterly revenue grew"),
    );
    expect(parsed.status).toBe("parsed");
    expect(parsed.structure).toEqual({ pages: 1 });
    expect(parsed.chunks[0]).toMatchObject({ locator: "page 1" });
    expect(parsed.text).toContain("Quarterly revenue grew");
  });

  it("stores images without pretending to read them", async () => {
    const parsed = await parseAttachment("image", new Uint8Array([1, 2, 3]));
    expect(parsed.status).toBe("unsupported");
    expect(parsed.chunks).toHaveLength(0);
    expect(parsed.error).toMatch(/does not read images/);
  });

  it("never builds a chunk over the limit", () => {
    const text = `${"a".repeat(4000)}\n\n${"b ".repeat(900)}`;
    const chunks = chunkText(text, (index) => `part ${index + 1}`);
    expect(chunks.every((chunk) => chunk.content.length <= 1500)).toBe(true);
    expect(
      chunks
        .map((chunk) => chunk.content)
        .join("")
        .replace(/\s/g, ""),
    ).toBe(text.replace(/\s/g, ""));
  });
});
