/** Time source. Injected so tests can move time (OTP expiry, session expiry) deterministically. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = { now: () => new Date() };

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}
