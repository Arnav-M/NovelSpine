import { useRef } from "react";
import { useModalA11y } from "../a11y/useModalA11y";
import type { AudiobookSwitchPrompt } from "../player/PlayerContext";

interface Props {
  prompt: AudiobookSwitchPrompt;
  onContinue: () => void;
  onSwitch: () => void;
}

export default function AudiobookSwitchModal({ prompt, onContinue, onSwitch }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useModalA11y(dialogRef, { open: true, onClose: onContinue, initialFocusRef: continueRef });

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audiobook-switch-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="audiobook-switch-title">New audiobook ready</h2>
        <p className="modal-body-text">
          <strong>{prompt.label}</strong> finished generating
          {prompt.extraReady ? ` (+${prompt.extraReady} more ready)` : ""} while you have{" "}
          <strong>{prompt.currentLabel}</strong> loaded.
        </p>
        <p className="modal-body-text muted">Switch now, or keep your current playback.</p>
        <div className="modal-actions">
          <button ref={continueRef} type="button" className="btn btn-ghost" onClick={onContinue}>
            Continue listening
          </button>
          <button type="button" className="btn btn-accent" onClick={onSwitch}>
            Switch to new audiobook
          </button>
        </div>
      </div>
    </div>
  );
}
