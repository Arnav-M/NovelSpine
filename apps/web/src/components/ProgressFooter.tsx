export interface ProgressState {
  title: string;
  message: string;
  progress: number;
  tone: "idle" | "running" | "success" | "danger";
  busy: boolean;
  jobId?: string;
  eta?: string;
}

interface Props {
  state: ProgressState;
  onCancel?: () => void;
}

export default function ProgressFooter({ state, onCancel }: Props) {
  const percent = Math.max(0, Math.min(100, state.progress));
  const statusText = [state.message, state.eta && state.busy ? `ETA ${state.eta}` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="footer-progress">
      <div className="footer-top">
        <span className="footer-title">{state.title}</span>
        <span className="footer-meta" aria-live="polite">
          {statusText}
          {state.busy && state.jobId && onCancel && (
            <>
              {" · "}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "0 4px" }}
                aria-label="Cancel job"
                onClick={onCancel}
              >
                Cancel
              </button>
            </>
          )}
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={state.title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} percent`}
      >
        <div
          className={`progress-fill ${state.tone === "success" ? "success" : ""} ${state.tone === "danger" ? "danger" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
