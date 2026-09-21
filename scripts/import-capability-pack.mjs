import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const packRoot = process.argv[2];
const outputPath = process.argv[3] ?? "src/lib/skills/capability-pack.ts";

if (!packRoot) {
  throw new Error(
    "Usage: node scripts/import-capability-pack.mjs <pack-root> [output]",
  );
}

const capabilityByCategory = {
  "agent-core": ["general"],
  "backend-databases": ["coding", "general"],
  "benchmarking-quality": ["coding", "research", "general"],
  "cloud-devops": ["coding", "general"],
  "coding-core": ["coding"],
  "connectors-automation": ["general", "research"],
  "data-ml": ["data", "math_science"],
  "frontend-ux": ["coding"],
  "math-science": ["math_science"],
  "multimodal-docs": ["multimodal", "general"],
  "product-business": ["general"],
  "research-web": ["research", "general"],
  "security-reliability": ["coding", "general"],
  "testing-debugging": ["coding", "general"],
};

const riskByCategory = {
  "connectors-automation": "high",
  "security-reliability": "medium",
  "cloud-devops": "medium",
};

function activation(description, name) {
  const terms =
    `${name} ${description}`.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ??
    [];
  return [...new Set(terms)].slice(0, 8);
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else if (entry.name === "metadata.json") output.push(path);
  }
  return output;
}

const metadataPaths = await walk(join(packRoot, "skills"));
const skills = await Promise.all(
  metadataPaths.map(async (metadataPath) => {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    const instructionPath = join(packRoot, metadata.path);
    const instruction = await readFile(instructionPath, "utf8");
    const category = metadata.category;
    return {
      id: metadata.id,
      slug: metadata.name,
      name: metadata.name,
      version: "0.1.0",
      category,
      description: metadata.description,
      instruction,
      priority: metadata.priority,
      activation: activation(metadata.description, metadata.name),
      capabilities: capabilityByCategory[category] ?? ["general"],
      risk: riskByCategory[category] ?? "low",
      requiredTools: [],
      contextCost: Math.max(40, Math.ceil(instruction.length / 4)),
      source: {
        pack: "Osirus_Capability_Pack_v0.1",
        sourcePath: relative(packRoot, instructionPath),
        contentOrigin: metadata.content_origin,
        upstreamInspirations: metadata.upstream_inspirations,
      },
    };
  }),
);

skills.sort((left, right) => left.id.localeCompare(right.id));
const source = `/* This file is generated from Osirus_Capability_Pack_v0.1. Do not edit manually. */\n\nexport type CapabilityPackSkill = {\n  id: string;\n  slug: string;\n  name: string;\n  version: string;\n  category: string;\n  description: string;\n  instruction: string;\n  priority: "P0" | "P1";\n  activation: string[];\n  capabilities: string[];\n  risk: "low" | "medium" | "high";\n  requiredTools: string[];\n  contextCost: number;\n  source: Record<string, unknown>;\n};\n\nexport const osirusCapabilityPack: CapabilityPackSkill[] = ${JSON.stringify(skills, null, 2)};\n`;
await writeFile(outputPath, source);
console.log(`Wrote ${skills.length} skills to ${outputPath}`);
