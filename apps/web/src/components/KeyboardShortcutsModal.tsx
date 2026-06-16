import { useRef } from "react";
import { useModalA11y } from "../a11y/useModalA11y";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  ["Space", "Play or pause"],
  ["Left arrow", "Back 10 seconds"],
  ["Right arrow", "Forward 10 seconds"],
  ["[", "Previous chapter"],
  ["]", "Next chapter"],
  ["?", "Show this help"],
];

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useModalA11y(dialogRef, { open, onClose, initialFocusRef: closeRef });

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <p className="estimate muted">Active on the Player tab when not typing in a field.</p>
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map(([key, action]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button ref={closeRef} type="button" className="btn btn-accent" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
