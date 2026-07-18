interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}

/** Filter chip with optional count, per the mockup toolrow. */
export default function FilterChip({ active, onClick, count, children }: FilterChipProps) {
  return (
    <button type="button" className={`chip${active ? " is-on" : ""}`} onClick={onClick}>
      {children}
      {count !== undefined ? <span className="n">{count}</span> : null}
    </button>
  );
}
