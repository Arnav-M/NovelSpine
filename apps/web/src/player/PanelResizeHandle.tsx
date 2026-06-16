import { memo, useCallback } from "react";

interface Props {
  label: string;
  active?: boolean;
  className?: string;
  onDragStart: (clientX: number) => void;
}

function PanelResizeHandle({ label, active = false, className = "", onDragStart }: Props) {
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onDragStart(event.clientX);
    },
    [onDragStart],
  );

  return (
    <div
      className={`panel-resize-handle${active ? " panel-resize-handle--active" : ""}${className ? ` ${className}` : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
    />
  );
}

export default memo(PanelResizeHandle);
