import type { MeetingPresenceStatus } from './types.ts'

/** One newline-delimited worker state message. */
export interface MeetingWorkerState {
  type: 'state'
  status: Extract<MeetingPresenceStatus, 'waiting-admission' | 'joined' | 'left'>
}

/** One newline-delimited worker failure message. */
export interface MeetingWorkerError {
  type: 'error'
  code: string
  message: string
}

/** Worker-to-host protocol message. */
export type MeetingWorkerMessage = MeetingWorkerState | MeetingWorkerError

const WORKER_STATES = new Set(['waiting-admission', 'joined', 'left'])

/**
 * Validate one JSON value received from the worker process.
 * @param value - parsed untrusted JSON.
 * @returns a protocol message, or `undefined` when the value violates the wire format.
 */
export function parseMeetingWorkerMessage(value: unknown): MeetingWorkerMessage | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.type === 'state' && typeof record.status === 'string' && WORKER_STATES.has(record.status)) {
    return { type: 'state', status: record.status as MeetingWorkerState['status'] }
  }
  if (record.type === 'error'
    && typeof record.code === 'string' && record.code.length > 0 && record.code.length <= 80
    && typeof record.message === 'string' && record.message.length > 0 && record.message.length <= 1000) {
    return { type: 'error', code: record.code, message: record.message }
  }
  return undefined
}
