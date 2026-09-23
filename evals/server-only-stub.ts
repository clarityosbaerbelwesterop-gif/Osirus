// Next.js resolves "server-only" at build time. The arena runs the same server
// modules under Vitest, outside any client bundle, so the guard has nothing to
// guard and resolves to this empty module instead.
export {};
