import { notFound } from "next/navigation";
import { fetchTraderProfile } from "@/lib/api";
import TraderCard from "@/components/TraderCard";

export default async function TraderPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await fetchTraderProfile(handle);
  if (!profile) notFound();

  return (
    <div>
      <TraderCard profile={profile} />
    </div>
  );
}
