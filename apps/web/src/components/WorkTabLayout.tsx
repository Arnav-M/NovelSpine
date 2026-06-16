import { useEffect, useState, type ReactNode } from "react";
import ActivityLog, { type LogEntry } from "./ActivityLog";

interface Props {
  children: ReactNode;
  logEntries: LogEntry[];
  onClearLog: () => void;
  autoExpand?: boolean;
  logCollapsedPref?: boolean;
  onLogCollapsedChange?: (collapsed: boolean) => void;
}

export default function WorkTabLayout({
  children,
  logEntries,
  onClearLog,
  autoExpand = false,
  logCollapsedPref = true,
  onLogCollapsedChange,
}: Props) {
  const [collapsed, setCollapsed] = useState(logCollapsedPref);

  useEffect(() => {
    setCollapsed(logCollapsedPref);
  }, [logCollapsedPref]);

  useEffect(() => {
    if (autoExpand) {
      setCollapsed(false);
      onLogCollapsedChange?.(false);
    }
  }, [autoExpand, onLogCollapsedChange]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    onLogCollapsedChange?.(next);
  };

  return (
    <div className="work-tab-layout">
      <div className="work-tab-main">{children}</div>
      <div className="work-tab-log">
        <div className="activity-log-header">
          <button type="button" className="activity-log-toggle" onClick={toggle}>
            <span>{collapsed ? "▸" : "▾"}</span>
            <strong>Activity log</strong>
          </button>
          <button type="button" className="btn btn-ghost activity-log-clear" onClick={onClearLog}>
            Clear
          </button>
        </div>
        {!collapsed && <ActivityLog entries={logEntries} onClear={onClearLog} embedded />}
      </div>
    </div>
  );
}
