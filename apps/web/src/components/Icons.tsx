const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
export const EyeIcon = () => (<svg {...base}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>);
export const CopyIcon = () => (<svg {...base}><rect x="5.5" y="5.5" width="8" height="8" rx="2" /><path d="M10.5 5.5v-1a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h1" /></svg>);
export const CheckIcon = () => (<svg {...base}><path d="m3.5 8.5 3 3 6-7" /></svg>);
export const ChevronIcon = () => (<svg {...base} width={12} height={12}><path d="m4 6.5 4 4 4-4" /></svg>);
