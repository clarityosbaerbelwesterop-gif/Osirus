import { describe, expect, it } from "vitest";
import { parseAttachment } from "@/lib/attachments/parse";

// A real PDF, built byte by byte with a correct xref table, so the parser
// (unpdf / pdf.js) runs its real code path instead of a mock.
function pdfWithPages(pages: string[]) {
  const objects: string[] = [];
  const font = 3 + pages.length * 2;
  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((text, index) => {
    const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("PDF attachments", () => {
  it("extracts the text of every page with its page locator", async () => {
    const parsed = await parseAttachment(
      "pdf",
      pdfWithPages([
        "Quarterly revenue 4.2 million",
        "Churn fell to 3 percent",
      ]),
    );
    expect(parsed.status).toBe("parsed");
    expect(parsed.structure).toEqual({ pages: 2 });
    expect(parsed.text).toContain("Quarterly revenue 4.2 million");
    expect(parsed.text).toContain("Churn fell to 3 percent");
    expect(parsed.chunks.map((chunk) => chunk.locator)).toEqual([
      "page 1",
      "page 2",
    ]);
  });

  it("reports a PDF without text instead of answering from nothing", async () => {
    const parsed = await parseAttachment("pdf", pdfWithPages([""]));
    expect(parsed.status).toBe("unsupported");
    expect(parsed.error).toMatch(/no extractable text/);
  });

  it("fails closed on bytes that are not a PDF", async () => {
    const parsed = await parseAttachment(
      "pdf",
      new TextEncoder().encode("not a pdf at all"),
    );
    expect(parsed.status).not.toBe("parsed");
    expect(parsed.chunks).toEqual([]);
  });
});
