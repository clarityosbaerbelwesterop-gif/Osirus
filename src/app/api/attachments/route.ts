import { z } from "zod";
import {
  AttachmentError,
  listAttachments,
  saveAttachment,
} from "@/lib/attachments/store";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments/parse";
import { apiIdentity, guardAction, json } from "@/lib/product/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ERROR_STATUS = { empty: 400, too_large: 413, unsupported_type: 415 };

export async function GET(request: Request) {
  const identity = await apiIdentity();
  if (!identity) return json({ error: "unauthorized" }, 401);
  const sessionId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("sessionId")).data;
  return json({
    attachments: await listAttachments(identity, {
      sessionId: sessionId ?? null,
    }),
  });
}

// One file per request, multipart/form-data with a "file" field (and an
// optional "sessionId"). The type is decided from the bytes, not the name.
export async function POST(request: Request) {
  const guard = await guardAction(request, {
    route: "attachments.upload",
    limit: 30,
  });
  if (!guard.ok) return guard.response;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_ATTACHMENT_BYTES + 64 * 1024)
    return json({ error: "too_large" }, 413);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("multipart/form-data")
  )
    return json({ error: "unsupported_media_type" }, 415);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "invalid_request" }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES)
    return json({ error: "too_large" }, 413);
  const sessionId = z.string().uuid().safeParse(form.get("sessionId")).data;
  try {
    const attachment = await saveAttachment(guard.identity, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      sessionId: sessionId ?? null,
    });
    return json({ attachment }, 201);
  } catch (error) {
    if (error instanceof AttachmentError)
      return json({ error: error.code }, ERROR_STATUS[error.code]);
    return json({ error: "upload_failed" }, 500);
  }
}
