export default function Spinner({ label, small = false }: { label?: string; small?: boolean }) {
  if (small) {
    return <span className="loading-spinner loading-spinner--sm" role="status" aria-label={label ?? "Loading"} />;
  }
  return (
    <div className="loading-full" role="status">
      <div className="loading-spinner" />
      {label ? <div className="lbl">{label}</div> : null}
    </div>
  );
}
