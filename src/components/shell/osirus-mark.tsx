/** The Osirus mark: an open ring with a compass diamond. Decorative next to the wordmark. */
export function OsirusMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="osirus-mark"
    >
      <circle cx="16" cy="16" r="15" fill="var(--color-accent-soft)" />
      <path
        d="M22.8 9.15a10 10 0 1 0 2.15 10.15"
        stroke="var(--color-accent-text)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M16 10.4 L18.35 16 L16 21.6 L13.65 16 Z"
        fill="var(--color-accent-text)"
      />
    </svg>
  );
}
