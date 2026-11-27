/**
 * Infrastructure probes used by readiness. Kept behind an interface so tests can substitute them
 * without mocking drivers.
 */
export interface DependencyProbe {
  name: 'database' | 'redis';
  check(): Promise<boolean>;
}

export const DEPENDENCY_PROBES = Symbol('DEPENDENCY_PROBES');

/** Runs a probe with a timeout; any error or timeout counts as down. */
export async function probe(dep: DependencyProbe, timeoutMs = 1500): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      dep.check(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
