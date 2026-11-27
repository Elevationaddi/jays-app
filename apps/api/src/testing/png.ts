import { crc32, deflateSync } from 'node:zlib';

/**
 * A small real PNG encoder (8-bit RGB) for fictional seed images and tests: a two-colour diagonal
 * gradient with an optional centred disc. Nothing here is a real brand asset.
 */
export function renderPng(
  width: number,
  height: number,
  options: {
    from: [number, number, number];
    to: [number, number, number];
    disc?: [number, number, number];
  },
): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;
  for (let y = 0; y < height; y += 1) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      let rgb = options.from.map((c, i) => Math.round(c + ((options.to[i] ?? c) - c) * t));
      if (options.disc && (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) rgb = options.disc;
      raw.set(rgb, y * row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A minimal, valid, clearly fictional PDF. */
export function fictionalPdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
