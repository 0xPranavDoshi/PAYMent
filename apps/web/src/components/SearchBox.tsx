"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const handle = value.trim().replace(/^@/, "");
        if (handle) {
          router.push(`/traders/${encodeURIComponent(handle)}`);
          setValue("");
        }
      }}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Search a handle" aria-label="Search for a trader by handle" />
    </form>
  );
}
