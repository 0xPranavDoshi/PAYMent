/** Small line icons for the trade buttons. They take their colour from the text around them. */
const base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const PaperIcon = () => (
  <svg {...base}>
    <path d="M4 2.5h5.2L12 5.3V13a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13V2.5z" />
    <path d="M9 2.5v3h3" />
  </svg>
);

export const CopyIcon = () => (
  <svg {...base}>
    <rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.6" />
    <path d="M3 10.5V4.6A1.6 1.6 0 0 1 4.6 3h5.9" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...base}>
    <path d="M3.5 8.4l3 3 6-6.8" />
  </svg>
);
