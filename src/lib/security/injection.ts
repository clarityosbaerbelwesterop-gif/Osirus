// Text that tries to address the model instead of informing it: attempts to
// override instructions, fake fences or role tags, or ask for secrets. Found
// in tool results and MCP descriptions, it is neutralized by the untrusted
// fencing; this detector only makes the attempt visible as a security event.

const PATTERNS = [
  /-{5,}\s*(BEGIN|END)\b/i,
  /UNTRUSTED TOOL RESULT/i,
  /<\/?(system|instructions?|assistant)>/i,
  /\bignore (all |any |the )?(previous|prior|above) (instructions|messages)/i,
  /\b(reveal|print|send|exfiltrate) (the |your )?(system prompt|api key|token|secret|credentials)/i,
  /\byou are now\b.{0,40}\b(system|admin|developer)\b/i,
];

export function containsInjectionAttempt(text: string) {
  return PATTERNS.some((pattern) => pattern.test(text));
}
