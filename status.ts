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
export class StatusEvent<
  T extends StatusEnum = typeof Status.Idle,
  TDetail = unknown,
> extends CustomEvent<TDetail> {
  constructor(public status = Status.Idle as T, detail?: TDetail) {
    super("status", { detail: Object.assign({}, detail) });
  }
}

/**
 * A map defining the specific StatusEvent detail types for each status.
 */
export interface StatusEventDetailMap extends Record<StatusEnum, unknown> {
  [Status.Idle]: unknown;
  [Status.Running]: unknown;
  [Status.Paused]: unknown;
  [Status.Completed]: { value: unknown };
  [Status.Cancelled]: { reason: unknown };
  [Status.Destroyed]: unknown;
}

/**
 * A map defining the specific StatusEvent types for each status.
 */
export type StatusEventMap = {
  [K in StatusEnum]: StatusEvent<StatusEnum, StatusEventDetailMap[K]>;
};
