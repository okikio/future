export const Status = {
  Idle: "idle",
  Running: "running",
  Paused: "paused",
  Completed: "completed",
  Cancelled: "cancelled",
  Destroyed: "destroyed",
} as const;

export type StatusEnum = typeof Status[keyof typeof Status];


/**
 * Custom event for different statuses in the application, extending from CustomEvent.
 *
 * @template T - The specific status of the event.
 * @template TDetail - The detailed data associated with the event.
 */
export class StatusEvent<T extends StatusEnum, TDetail = unknown>
  extends CustomEvent<TDetail> {
  constructor(public status = Status.Idle as T, detail?: TDetail) {
    super("status", { detail: Object.assign({}, detail) });
  }
}

/**
 * A map defining the specific StatusEvent types for each status.
 */
export interface StatusEventMap extends Record<StatusEnum, StatusEvent<StatusEnum, unknown>> {
  [Status.Idle]: StatusEvent<typeof Status.Idle, unknown>;
  [Status.Running]: StatusEvent<typeof Status.Running, unknown>;
  [Status.Paused]: StatusEvent<typeof Status.Paused, unknown>;
  [Status.Completed]: StatusEvent<typeof Status.Completed, { value: unknown }>;
  [Status.Cancelled]: StatusEvent<typeof Status.Cancelled, { reason: unknown }>;
  [Status.Destroyed]: StatusEvent<typeof Status.Destroyed, unknown>;
}
