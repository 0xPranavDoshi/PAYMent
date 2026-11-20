import AutoRefresh from "./AutoRefresh";

/**
 * The page container. `live` makes the page re-read its data on its own (see AutoRefresh), for pages that show
 * scan results, scores and trades, so they are never left showing what they had when they loaded.
 */
export default function Page({ children, live = false }: { children: React.ReactNode; live?: boolean }) {
  return (
    <div className="container page">
      {live && <AutoRefresh />}
      {children}
    </div>
  );
}
