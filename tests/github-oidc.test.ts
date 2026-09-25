import { createSign, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  OIDC_AUDIENCE,
  OIDC_ISSUER,
  PULSE_REPOSITORY,
  PULSE_WORKFLOW,
  resetOidcKeyCache,
  verifyGithubOidc,
} from "../src/lib/security/github-oidc";

const github = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...github.publicKey.export({ format: "jwk" }), kid: "k1" };
const fetchImpl = (async () =>
  new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
  })) as unknown as typeof fetch;

const now = Math.floor(Date.parse("2026-09-25T10:00:00Z") / 1000);

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: OIDC_ISSUER,
    aud: OIDC_AUDIENCE,
    iat: now - 10,
    nbf: now - 10,
    exp: now + 300,
    repository: PULSE_REPOSITORY,
    ref: "refs/heads/main",
    workflow_ref: `${PULSE_REPOSITORY}/${PULSE_WORKFLOW}@refs/heads/main`,
    event_name: "schedule",
    ...overrides,
  };
}

function token(
  body: Record<string, unknown>,
  options: { key?: typeof github.privateKey; alg?: string; kid?: string } = {},
) {
  const header = Buffer.from(
    JSON.stringify({ alg: options.alg ?? "RS256", kid: options.kid ?? "k1" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer
    .sign(options.key ?? github.privateKey)
    .toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const check = (value: string) =>
  verifyGithubOidc(value, undefined, { fetchImpl, now: now * 1000 });

describe("GitHub OIDC for the hourly tick", () => {
  beforeEach(() => resetOidcKeyCache());

  it("accepts the pulse workflow on main, scheduled or dispatched", async () => {
    expect((await check(token(claims()))).ok).toBe(true);
    expect(
      (await check(token(claims({ event_name: "workflow_dispatch" })))).ok,
    ).toBe(true);
  });

  it("refuses a token GitHub did not sign", async () => {
    const forged = await check(token(claims(), { key: attacker.privateKey }));
    expect(forged).toEqual({ ok: false, reason: "signature" });
    const none = await check(token(claims(), { alg: "none" }));
    expect(none).toEqual({ ok: false, reason: "algorithm" });
    const hmac = await check(token(claims(), { alg: "HS256" }));
    expect(hmac).toEqual({ ok: false, reason: "algorithm" });
    const unknown = await check(token(claims(), { kid: "other" }));
    expect(unknown).toEqual({ ok: false, reason: "unknown_key" });
    expect(await check("not.a.jwt.at.all")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses every other repository, workflow, branch, event or audience", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ repository: "someone/Osirus" }, "repository"],
      [{ ref: "refs/heads/feature" }, "ref"],
      [
        {
          workflow_ref: `${PULSE_REPOSITORY}/.github/workflows/ci.yml@refs/heads/main`,
        },
        "workflow",
      ],
      [{ event_name: "pull_request" }, "event"],
      [{ aud: "https://github.com/clarityosbaerbelwesterop-gif" }, "audience"],
      [{ iss: "https://evil.example" }, "issuer"],
      [{ exp: now - 3600 }, "expired"],
    ];
    for (const [overrides, reason] of cases)
      expect(await check(token(claims(overrides))), reason).toEqual({
        ok: false,
        reason,
      });
  });
});
