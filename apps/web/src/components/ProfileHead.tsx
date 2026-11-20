"use client";

import { useState, type ReactNode } from "react";
import CopyTicket, { CopyTradeToggle, type CopyState } from "./CopyTicket";

/** The profile's header card. It owns the ticket's open state so the ticket opens directly under the card. */
export default function ProfileHead({
  handle,
  copy,
  viewerId,
  nPicks,
  watch,
  children,
}: {
  handle: string;
  copy: CopyState | null;
  viewerId: string | null;
  nPicks: number;
  watch: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const signedIn = viewerId !== null;
  return (
    <>
      <div className="card phead">
        {children}
        <div className="acts">
          <CopyTradeToggle handle={handle} copy={copy} signedIn={signedIn} viewerId={viewerId} nPicks={nPicks} primary size="lg" ticketPlacement="below" open={open} onOpenChange={setOpen} />
          {watch}
        </div>
      </div>
      {open && <CopyTicket handle={handle} copy={copy} signedIn={signedIn} viewerId={viewerId} nPicks={nPicks} variant="card" onClose={() => setOpen(false)} />}
    </>
  );
}
