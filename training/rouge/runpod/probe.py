"""Read-only RunPod probe for the H200 plan: no pod, no volume, no cost.

Prints what the launcher needs before any paid step:
- the REST schema for pods and network volumes (H200 GPU type ids, data centers,
  fields for volumes, ports and environment);
- the live H200 prices and stock (GraphQL `gpuTypes`);
- the account's existing network volumes and running pods, and its balance
  (so the ceiling check can also compare with the money actually available).

    RUNPOD_API_KEY=... python training/rouge/runpod/probe.py

The key is sent only in the Authorization header and never printed.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

REST = "https://rest.runpod.io/v1"
GRAPHQL = "https://api.runpod.io/graphql"


def get_json(url: str, headers: dict | None = None, body: dict | None = None) -> dict:
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json", "User-Agent": "rouge-probe/1", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as error:
        return {"_error": f"HTTP {error.code}: {error.read().decode()[:300]}"}


def graphql(query: str) -> dict:
    return get_json(GRAPHQL, {"Authorization": f"Bearer {os.environ['RUNPOD_API_KEY']}"}, {"query": query})


def rest_schema() -> dict:
    spec = get_json(f"{REST}/openapi.json")

    def resolve(schema):
        ref = schema.get("$ref")
        return resolve(spec["components"]["schemas"][ref.split("/")[-1]]) if ref else schema

    out = {"paths": sorted(p for p in spec.get("paths", {}) if "pod" in p or "volume" in p.lower())}
    for path in ("/pods", "/networkvolumes"):
        post = (spec.get("paths", {}).get(path) or {}).get("post")
        if not post:
            continue
        schema = resolve(post["requestBody"]["content"]["application/json"]["schema"])
        fields = {}
        for name, field in schema.get("properties", {}).items():
            field = resolve(field)
            enum = field.get("enum") or (resolve(field.get("items") or {})).get("enum")
            fields[name] = {"type": field.get("type"), "default": field.get("default")}
            if enum:
                fields[name]["enum"] = [e for e in enum if "H200" in e or "H100" in e] if name == "gpuTypeIds" else enum[:40]
        out[path] = {"fields": fields, "required": schema.get("required")}
    return out


def main() -> None:
    print("== REST schema (public)")
    print(json.dumps(rest_schema(), indent=1)[:12000])
    if not os.environ.get("RUNPOD_API_KEY"):
        print("RUNPOD_API_KEY not set: account queries skipped")
        return
    print("== H200 and H100 prices and stock (GraphQL)")
    gpus = graphql("""query { gpuTypes { id displayName memoryInGb securePrice communityPrice secureSpotPrice
                       lowestPrice(input: {gpuCount: 1}) { uninterruptablePrice minimumBidPrice stockStatus } } }""")
    rows = [g for g in (gpus.get("data") or {}).get("gpuTypes") or [] if "H200" in g["id"] or "H100" in g["id"]]
    print(json.dumps(rows or gpus, indent=1)[:4000])
    print("== data centers with H200 stock (GraphQL)")
    dcs = graphql("""query { dataCenters { id name location storageSupport
                       gpuAvailability { gpuTypeId stockStatus available } } }""")
    if "data" in dcs and dcs["data"]:
        for dc in dcs["data"]["dataCenters"] or []:
            h200 = [g for g in dc.get("gpuAvailability") or [] if "H200" in (g.get("gpuTypeId") or "")]
            if h200:
                print(json.dumps({"id": dc["id"], "location": dc.get("location"), "storage": dc.get("storageSupport"), "h200": h200}))
    else:
        print(json.dumps(dcs)[:600])
    print("== account (GraphQL): balance, spend rate, volumes, pods")
    me = graphql("""query { myself { clientBalance currentSpendPerHr spendLimit
                     networkVolumes { id name size dataCenterId }
                     pods { id name desiredStatus costPerHr } } }""")
    mine = (me.get("data") or {}).get("myself")
    if mine:
        print(json.dumps({"balance_usd": mine.get("clientBalance"), "spend_per_hour": mine.get("currentSpendPerHr"),
                          "spend_limit": mine.get("spendLimit"), "network_volumes": mine.get("networkVolumes"),
                          "pods": [{"id": p["id"], "status": p["desiredStatus"], "cost_per_hour": p.get("costPerHr")}
                                   for p in mine.get("pods") or []]}, indent=1))
    else:
        print(json.dumps(me)[:600])


if __name__ == "__main__":
    main()
