"use client";

import { useEffect, useState } from "react";

/** Whether chart animation is fine: false when the visitor asked for reduced motion. */
export function useMotionOk(): boolean {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    setOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return ok;
}
