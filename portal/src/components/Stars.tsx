interface StarsProps {
  value: number;
  onRate?: (rating: number) => void;
  title?: string;
}

/** 1-5 star rating row, mockup style. Read-only when onRate is omitted. */
export default function Stars({ value, onRate, title = "How did we handle this ticket?" }: StarsProps) {
  return (
    <div className="stars" title={title}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={value >= i ? "on" : ""}
          onClick={onRate ? () => onRate(i) : undefined}
          disabled={!onRate}
          aria-label={`${i} of 5`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.9 6.26 6.6.7-4.95 4.5 1.4 6.54L12 16.7 6.05 20l1.4-6.54L2.5 8.96l6.6-.7z" />
          </svg>
        </button>
      ))}
    </div>
  );
}
