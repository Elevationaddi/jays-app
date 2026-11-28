import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import type { MalwareScanner } from './storage.js';

const CHUNK = 64 * 1024;
const TIMEOUT_MS = 30_000;

export class ScannerUnavailableError extends Error {
  constructor(message = 'malware scanner unavailable') {
    super(message);
    this.name = 'ScannerUnavailableError';
  }
}

/**
 * ClamAV over clamd's INSTREAM protocol (ADR-0032), with node's own sockets, so no dependency
 * is added. ClamAV is open source; where clamd runs is a founder decision (it cannot run inside
 * a Vercel function). Over the internet the connection must use TLS (`CLAMAV_TLS=true`, for
 * example clamd behind stunnel), because files are sent to the scanner in full.
 *
 * Fails closed: if the scanner cannot be reached or answers anything but a clean result or a
 * detection, the upload is not accepted (the caller retries later), never passed unscanned.
 */
export class ClamavScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly tls: boolean,
  ) {}

  async scan(bytes: Uint8Array): Promise<{ clean: boolean; signature?: string }> {
    const reply = await this.instream(bytes);
    return parseClamdReply(reply);
  }

  private instream(bytes: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error instanceof ScannerUnavailableError ? error : new ScannerUnavailableError());
      };
      const onConnect = () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          const part = bytes.subarray(offset, offset + CHUNK);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
      };
      const socket: Socket = this.tls
        ? tlsConnect({ host: this.host, port: this.port, servername: this.host }, onConnect)
        : tcpConnect({ host: this.host, port: this.port }, onConnect);
      socket.setTimeout(TIMEOUT_MS, () => fail(new ScannerUnavailableError('scanner timed out')));
      socket.on('data', (data: Buffer) => chunks.push(data));
      socket.on('error', fail);
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  }
}

/** `stream: OK`, `stream: <signature> FOUND`; anything else (errors, size limits) fails closed. */
export function parseClamdReply(reply: string): { clean: boolean; signature?: string } {
  const text = reply.replace(/\0/g, '').trim();
  if (/^(stream|\d+): OK$/.test(text)) return { clean: true };
  const found = /^(?:stream|\d+): (.+) FOUND$/.exec(text);
  if (found) return { clean: false, signature: (found[1] as string).slice(0, 200) };
  throw new ScannerUnavailableError(`unexpected scanner reply`);
}
