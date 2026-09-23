/** The Osirus mark: an open ring. Decorative next to the wordmark. */
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
        d="M22.5 9.5a9 9 0 1 0 1.8 9"
        stroke="var(--color-accent-text)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="3" fill="var(--color-accent-text)" />
    </svg>
  );
}
