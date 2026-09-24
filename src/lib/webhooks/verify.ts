import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Signed webhook deliveries: who may start an automation from outside.
//
// Every source signs the raw body with the endpoint's secret; the receiver
// recomputes the signature and compares in constant time before reading a
// single field. Generic senders also sign a timestamp, so a captured request
// cannot be replayed later; GitHub and Vercel deliveries carry an id, and
// each id is accepted once. What comes out is a normalized event with a few
// strictly validated fields -- never free text from the payload, which is
// attacker-controlled on any public repository.

export type WebhookSource = "github" | "vercel" | "generic";

export type NormalizedEvent = {
  kind:
    | "push"
    | "pull_request"
    | "ci_failure"
    | "deployment"
    | "db_event"
    | "generic"
    | "ping";
  deliveryId: string;
  repository: string | null;
  ref: string | null;
  sha: string | null;
  status: string | null;
};

export const MAX_WEBHOOK_BYTES = 256 * 1024;
const TOLERANCE_SECONDS = 5 * 60;

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function signGeneric(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verifySignature(input: {
  source: WebhookSource;
  secret: string;
  body: string;
  headers: Headers;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { headers, secret, body } = input;
  if (input.source === "github") {
    const supplied = headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return equal(supplied, expected)
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  }
  if (input.source === "vercel") {
    const supplied = headers.get("x-vercel-signature") ?? "";
    const expected = createHmac("sha1", secret).update(body).digest("hex");
    return equal(supplied, expected)
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  }
  const timestamp = Number(headers.get("x-osirus-timestamp"));
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(now - timestamp) > TOLERANCE_SECONDS
  )
    return { ok: false, reason: "stale_timestamp" };
  const supplied = headers.get("x-osirus-signature") ?? "";
  return equal(supplied, signGeneric(secret, timestamp, body))
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;
const SHA = /^[0-9a-f]{7,64}$/i;
const STATUS = /^[a-z_]{1,40}$/;
const DELIVERY = /^[A-Za-z0-9_.:-]{1,120}$/;

const pick = (value: unknown, pattern: RegExp) =>
  typeof value === "string" && pattern.test(value) ? value : null;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  value && typeof value === "object" ? (value as Json) : {};

export function normalizeEvent(input: {
  source: WebhookSource;
  headers: Headers;
  body: string;
}): NormalizedEvent | null {
  let payload: Json;
  try {
    payload = obj(JSON.parse(input.body));
  } catch {
    return null;
  }
  const hash = createHash("sha256")
    .update(input.body)
    .digest("hex")
    .slice(0, 40);

  if (input.source === "github") {
    const event = input.headers.get("x-github-event") ?? "";
    const deliveryId =
      pick(input.headers.get("x-github-delivery"), DELIVERY) ?? hash;
    const repository = pick(obj(payload.repository).full_name, REPO);
    const base = { deliveryId, repository };
    switch (event) {
      case "ping":
        return { ...base, kind: "ping", ref: null, sha: null, status: null };
      case "push":
        return {
          ...base,
          kind: "push",
          ref: pick(payload.ref, REF),
          sha: pick(payload.after, SHA),
          status: null,
        };
      case "pull_request": {
        const pr = obj(payload.pull_request);
        return {
          ...base,
          kind: "pull_request",
          ref: pick(obj(pr.head).ref, REF),
          sha: pick(obj(pr.head).sha, SHA),
          status: pick(payload.action, STATUS),
        };
      }
      case "check_suite":
      case "check_run":
      case "workflow_run": {
        const run = obj(payload[event]);
        const conclusion = pick(run.conclusion, STATUS);
        if (conclusion !== "failure" && conclusion !== "timed_out") return null;
        return {
          ...base,
          kind: "ci_failure",
          ref: pick(run.head_branch, REF),
          sha: pick(run.head_sha, SHA),
          status: conclusion,
        };
      }
      case "deployment_status": {
        const status = obj(payload.deployment_status);
        return {
          ...base,
          kind: "deployment",
          ref: pick(obj(payload.deployment).ref, REF),
          sha: pick(obj(payload.deployment).sha, SHA),
          status: pick(status.state, STATUS),
        };
      }
      default:
        return null;
    }
  }

  if (input.source === "vercel") {
    const type = typeof payload.type === "string" ? payload.type : "";
    if (!type.startsWith("deployment")) return null;
    const meta = obj(obj(obj(payload.payload).deployment).meta);
    return {
      kind: "deployment",
      deliveryId: pick(payload.id, DELIVERY) ?? hash,
      repository:
        typeof meta.githubOrg === "string" &&
        typeof meta.githubRepo === "string"
          ? pick(`${meta.githubOrg}/${meta.githubRepo}`, REPO)
          : null,
      ref: pick(meta.githubCommitRef, REF),
      sha: pick(meta.githubCommitSha, SHA),
      status: pick(
        type.replace(/^deployment\.?/, "").replaceAll("-", "_") || "created",
        STATUS,
      ),
    };
  }

  const event = String(
    input.headers.get("x-osirus-event") ?? payload.event ?? "",
  );
  return {
    kind: event.startsWith("db.") ? "db_event" : "generic",
    deliveryId: pick(input.headers.get("x-osirus-delivery"), DELIVERY) ?? hash,
    repository: null,
    ref: null,
    sha: null,
    status: pick(event.replace(/[^a-z_]/gi, "_").toLowerCase(), STATUS),
  };
}

/** One line of verified, validated facts for the automation's objective. */
export function describeEvent(event: NormalizedEvent) {
  const parts = [event.kind.replace("_", " ")];
  if (event.repository) parts.push(`in ${event.repository}`);
  if (event.ref) parts.push(`on ${event.ref}`);
  if (event.sha) parts.push(`at ${event.sha.slice(0, 12)}`);
  if (event.status) parts.push(`(${event.status})`);
  return parts.join(" ");
}
