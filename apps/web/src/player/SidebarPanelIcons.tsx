interface IconProps {
  className?: string;
}

/** Table-of-contents / chapter list */
export function ChaptersPanelIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden
      focusable="false"
    >
      <path
        d="M2 3.5h12M2 8h12M2 12.5h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Open book — read-along panel */
export function ReadingPanelIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden
      focusable="false"
    >
      <path
        d="M2.5 2.5h4.75v11H3.25c-.55 0-1-.45-1-1V2.5zm6.75 0H13.5c.55 0 1 .45 1 1v9.5H9.25V2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M7 2.5v11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
