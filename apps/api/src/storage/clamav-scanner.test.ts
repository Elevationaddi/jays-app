import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClamavScanner, parseClamdReply, ScannerUnavailableError } from './clamav-scanner.js';
import { eicarTestFile } from './scanner.js';

// Mock test (ADR-0032): a fake clamd on a local port speaks the INSTREAM protocol. A real ClamAV
// is exercised only by the provider tests.
let server: Server;
let port: number;
const received: number[] = [];

beforeAll(async () => {
  server = createServer((socket) => {
    let buf = Buffer.alloc(0);
    let commandSeen = false;
    const body: Buffer[] = [];
    socket.on('data', (data: Buffer) => {
      buf = Buffer.concat([buf, data]);
      if (!commandSeen) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        if (buf.subarray(0, end).toString() !== 'zINSTREAM') {
          socket.end('UNKNOWN COMMAND\0');
          return;
        }
        commandSeen = true;
        buf = buf.subarray(end + 1);
      }
      while (buf.length >= 4) {
        const size = buf.readUInt32BE(0);
        if (size === 0) {
          const all = Buffer.concat(body);
          received.push(all.length);
          socket.end(
            all.includes(eicarTestFile()) ? 'stream: Eicar-Signature FOUND\0' : 'stream: OK\0',
          );
          return;
        }
        if (buf.length < 4 + size) return;
        body.push(buf.subarray(4, 4 + size));
        buf = buf.subarray(4 + size);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('ClamavScanner', () => {
  it('streams a file in chunks and reports a clean result', async () => {
    const scanner = new ClamavScanner('127.0.0.1', port, false);
    const big = Buffer.alloc(200 * 1024, 1);
    expect(await scanner.scan(big)).toEqual({ clean: true });
    expect(received.at(-1)).toBe(big.length);
  });

  it('reports a detection with its signature', async () => {
    const scanner = new ClamavScanner('127.0.0.1', port, false);
    const file = Buffer.concat([Buffer.from('%PDF-1.4\n'), eicarTestFile()]);
    expect(await scanner.scan(file)).toEqual({ clean: false, signature: 'Eicar-Signature' });
  });

  it('fails closed when clamd cannot be reached', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const deadPort = (closed.address() as { port: number }).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const scanner = new ClamavScanner('127.0.0.1', deadPort, false);
    await expect(scanner.scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});

describe('parseClamdReply', () => {
  it('accepts only a clean result or a detection', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ clean: true });
    expect(parseClamdReply('1: OK')).toEqual({ clean: true });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({
      clean: false,
      signature: 'Win.Test.EICAR_HDB-1',
    });
    for (const reply of [
      '',
      'INSTREAM size limit exceeded. ERROR',
      'stream: OK extra',
      'garbage',
    ]) {
      expect(() => parseClamdReply(reply)).toThrow(ScannerUnavailableError);
    }
  });
});
