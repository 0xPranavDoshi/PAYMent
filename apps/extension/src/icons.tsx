/** Small line icons for the trade buttons. They take their colour from the text around them. */
const base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const EyeIcon = () => (
  <svg {...base}>
    <path d="M1.5 8s2.3-4.5 6.5-4.5S14.5 8 14.5 8s-2.3 4.5-6.5 4.5S1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...base}>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6" />
    <path d="M3 10.5V4.6A1.6 1.6 0 0 1 4.6 3h5.9" />
  </svg>
);

export const ArrowUpRightIcon = () => (
  <svg {...base}>
    <path d="M5 11l6-6M6 5h5v5" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base}>
    <path d="M3.5 8.4l3 3 6-6.8" />
  </svg>
);
