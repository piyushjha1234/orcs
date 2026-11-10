// Prints a QR code in the terminal, so a phone on the same network can open the link.
import { createRequire } from 'node:module';

interface QrCode {
  addData(data: string): void;
  make(): void;
  createASCII(cellSize?: number, margin?: number): string;
}

const require = createRequire(import.meta.url);
const qrcode = require('./vendor/qrcode-generator.cjs') as (typeNumber: number, errorCorrection: 'L' | 'M' | 'Q' | 'H') => QrCode;

export function terminalQr(data: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr.createASCII(1);
}
