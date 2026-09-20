import type { RuntimePacket } from "./types";

export function encodeSse(packet: RuntimePacket) {
  return `data: ${JSON.stringify(packet)}\n\n`;
}

export function parseSsePackets(input: string) {
  return input
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n"),
    )
    .filter(Boolean)
    .map((payload) => JSON.parse(payload) as RuntimePacket);
}
