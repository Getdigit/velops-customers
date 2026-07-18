import { STATUS, TRACKER_STEPS, isSettled, stepFor } from "../types";

/**
 * 4-step status tracker, logic mirrored 1:1 from the mockup:
 * steps before the current one are done; the current step renders
 * as done when the ticket is Resolved/Closed, otherwise as current.
 * Step 3 ("In Progress") is relabelled "In Development" when the
 * ticket is in that status.
 */
export default function StepTracker({ statuscode }: { statuscode: number }) {
  const s = stepFor(statuscode);
  const settled = isSettled(statuscode);
  return (
    <div className="tracker">
      {TRACKER_STEPS.map((label, i) => {
        const state = i < s ? "done" : i === s ? (settled ? "done" : "current") : "";
        const shown = i === 2 && statuscode === STATUS.IN_DEVELOPMENT ? "In Development" : label;
        return (
          <div className={`tstep ${state}`} key={label}>
            <div className="tstep__dot">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="3.4" strokeLinecap="round">
                <path d="M5 13l5 5L20 6" />
              </svg>
            </div>
            <div className="tstep__label">{shown}</div>
          </div>
        );
      })}
    </div>
  );
}
