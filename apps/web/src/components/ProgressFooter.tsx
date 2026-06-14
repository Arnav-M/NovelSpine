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
  return (
    <footer className="footer-progress">
      <div className="footer-top">
        <span className="footer-title">{state.title}</span>
        <span className="footer-meta">
          {state.message}
          {state.eta && state.busy ? ` · ETA ${state.eta}` : ""}
          {state.busy && state.jobId && onCancel && (
            <>
              {" · "}
              <button type="button" className="btn btn-ghost" style={{ padding: "0 4px" }} onClick={onCancel}>
                Cancel
              </button>
            </>
          )}
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill ${state.tone === "success" ? "success" : ""} ${state.tone === "danger" ? "danger" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, state.progress))}%` }}
        />
      </div>
    </footer>
  );
}
