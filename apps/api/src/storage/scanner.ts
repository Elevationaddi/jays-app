import type { MalwareScanner } from './storage.js';

/**
 * Local stand-in for a real scanner (ClamAV or the storage provider's scanning). It flags the
 * industry-standard EICAR test file, so the rejection path is exercised end to end. Production
 * refuses MALWARE_SCANNER=mock (ADR-0012).
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export class MockMalwareScanner implements MalwareScanner {
  scan(bytes: Uint8Array): Promise<{ clean: boolean; signature?: string }> {
    const text = Buffer.from(bytes).toString('latin1');
    return Promise.resolve(
      text.includes(EICAR) ? { clean: false, signature: 'EICAR-Test-File' } : { clean: true },
    );
  }
}

/** Exposed for tests that need an "infected" file. Built at runtime so scanners do not flag the repo. */
export const eicarTestFile = (): Buffer => Buffer.from(EICAR, 'latin1');
