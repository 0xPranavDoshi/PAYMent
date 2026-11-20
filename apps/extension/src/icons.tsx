/** Small line icons for the trade buttons. They take their colour from the text around them. */
const base = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

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
