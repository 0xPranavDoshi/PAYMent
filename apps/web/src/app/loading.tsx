export default function Loading() {
  return (
    <div className="container page" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 36, width: 220 }} />
      <div className="skel" style={{ height: 16, width: 420, marginTop: 14 }} />
      <div className="skel" style={{ height: 220, marginTop: 28 }} />
      <div className="skel" style={{ height: 120, marginTop: 14 }} />
    </div>
  );
}
