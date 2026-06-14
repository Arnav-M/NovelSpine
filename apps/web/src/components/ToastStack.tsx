export type ToastKind = "info" | "success" | "warn" | "danger";

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

interface Props {
  toasts: ToastItem[];
}

export default function ToastStack({ toasts }: Props) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
