import type { ReactNode } from "react";

interface PanelProps {
  readonly label: string;
  /** Right-hand header slot: toggles, actions, counters. */
  readonly right?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Instrument-module chrome shared by every stacked panel (Simulate, Simplify,
 * Problems): hairline frame, labeled header, right-hand control slot. Visuals
 * live in global.css under `.panel*`.
 */
export function Panel({ label, right, className, children }: PanelProps) {
  return (
    <section
      className={className ? `panel ${className}` : "panel"}
      style={{ marginTop: "1.25rem" }}
    >
      <header className="panel__header">
        <span className="panel__label">{label}</span>
        {right}
      </header>
      {children}
    </section>
  );
}
