"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface Hit {
  handle: string;
  score: number | null;
}

export default function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const latest = useRef(0);
  const q = value.trim().replace(/^@/, "");

  useEffect(() => {
    if (q === "") {
      setHits([]);
      setSearched(false);
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const found = (await res.json()) as Hit[];
        if (id === latest.current) {
          setHits(found);
          setActive(0);
          setSearched(true);
        }
      } catch {
        if (id === latest.current) setHits([]);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [q]);

  function go(handle: string) {
    setOpen(false);
    setValue("");
    router.push(`/traders/${encodeURIComponent(handle)}`);
  }

  return (
    <div className="search-wrap" onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q === "") return;
          // Prefer a match from the list; otherwise go to the exact handle, which explains if it is unknown.
          go(hits[active]?.handle ?? q);
        }}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a handle"
          aria-label="Search for a trader by handle"
          role="combobox"
          aria-expanded={open && q !== ""}
          aria-controls="search-results"
          autoComplete="off"
        />
      </form>
      {open && q !== "" && (
        <ul className="results" id="search-results" role="listbox">
          {hits.map((h, i) => (
            <li key={h.handle} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? "active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h.handle)}>
                <b>@{h.handle}</b>
                <span>{h.score === null ? "New" : h.score}</span>
              </button>
            </li>
          ))}
          {searched && hits.length === 0 && <li className="none">No trader matching “{q}” yet</li>}
        </ul>
      )}
    </div>
  );
}
