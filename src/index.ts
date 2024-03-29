import { parseBackendId } from './backendParser';
import { BackendParser } from './types';

type CircutState = 0 | 1 | 2;

const OPEN: CircutState = 0;
const HALF_OPEN: CircutState = 1;
const CLOSED: CircutState = 2;

interface BackendHealth {
  id: string;
  failures: number[];
  state: CircutState;
  openedAt?: number;
}

export interface Options {
  active: boolean;
  timespanMilliseconds?: number;
  openMilliseconds?: number;
  failureThreshold?: number;
  parseBackend?: BackendParser;
}

interface CircutBreakerState {
  [id: string]: BackendHealth;
}

export default class CircutBreaker {
  private active: boolean;
  private timespanMilliseconds: number;
  private openMilliseconds: number;
  private failureThreshold: number;
  private parseBackendId: BackendParser;

  private state: CircutBreakerState;

  constructor(opts: Options) {
    const { active, timespanMilliseconds, openMilliseconds, failureThreshold } = opts;
    this.active = active;
    this.timespanMilliseconds = timespanMilliseconds || 10000;
    this.openMilliseconds = openMilliseconds || 5000;
    this.failureThreshold = failureThreshold || 10;
    this.parseBackendId = opts.parseBackend || parseBackendId;
    this.state = {};
  }

  public isOpen(url: string) {
    if (!this.active) {
      return false;
    }

    const id = this.parseBackendId(url);
    return this.evaluate(id) === OPEN;
  }

  public record(url: string, status: number) {
    if (!this.active) {
      return false;
    }

    const id = this.parseBackendId(url);
    if (status >= 500) {
      this.recordFailure(id);
    } else {
      this.recordSuccess(id);
    }

    this.evaluate(id);
  }

  private evaluate(id: string): CircutState {
    const now = new Date().getTime();
    const backend = this.getOrCreateBackend(id);
    const { openedAt, state } = backend;
    if (state === OPEN && openedAt && now - this.openMilliseconds < openedAt) {
      return OPEN;
    }

    const failures = this.filterFailures(backend, now);
    const shouldOpen = failures.length >= this.failureThreshold;
    const nextState = state === OPEN ? HALF_OPEN : shouldOpen ? OPEN : CLOSED;

    this.state[id] = {
      ...backend,
      failures,
      openedAt: nextState === OPEN ? now : undefined,
      state: nextState,
    };

    return this.state[id].state;
  }

  private recordFailure(id: string) {
    const now = new Date().getTime();
    const backend = this.getOrCreateBackend(id);
    const state = backend.state === HALF_OPEN ? OPEN : backend.state;
    const openedAt = backend.state === HALF_OPEN ? now : backend.openedAt;

    this.state[id] = {
      ...backend,
      failures: [...backend.failures, now],
      openedAt,
      state,
    };
  }

  private recordSuccess(id: string) {
    const backend = this.getOrCreateBackend(id);
    this.state[id] = {
      ...backend,
      failures: [],
    };
  }

  private getOrCreateBackend(id: string): BackendHealth {
    const backend = this.state[id];
    if (backend) {
      return backend;
    }

    this.state[id] = newBackend(id);
    return this.state[id];
  }

  private filterFailures(backend: BackendHealth, now: number): number[] {
    const timespanBoundry = now - this.timespanMilliseconds;
    return backend.failures.filter((timestamp: number): boolean => timestamp > timespanBoundry);
  }
}

function newBackend(id: string): BackendHealth {
  return {
    failures: [],
    id,
    state: CLOSED,
  };
}
