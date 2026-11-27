import type { LogState } from "./logScreenLogic";

export interface DayListControlProps {
  state: LogState;
  busy: boolean;
  onDays?: () => void;
  onDayPick?: (date: string) => void;
  onDayMore?: () => void;
}

// The Days control and the day list (REQ-016/AC-001). The mark follows the server's open_past only (REQ-016/AC-004, AC-005).
export function DayListControl(props: DayListControlProps) {
  const list = props.state.dayList;
  return (
    <div>
      <button type="button" disabled={props.busy} onClick={() => props.onDays?.()} data-testid="log-days">
        Days
      </button>
      {list?.open ? (
        <section data-testid="day-list">
          <ul>
            {list.items.map((item) => (
              <li key={item.date}>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onDayPick?.(item.date)}
                  data-testid={`day-list-item-${item.date}`}
                  data-state={item.state}
                >
                  {item.date}
                </button>
                {item.openPast ? <span data-testid={`day-list-open-mark-${item.date}`}>Open, not closed yet</span> : null}
              </li>
            ))}
          </ul>
          {list.nextBefore !== null ? (
            <button type="button" disabled={props.busy} onClick={() => props.onDayMore?.()} data-testid="day-list-more">
              More days
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
