const ESC = 0x1B;
const GS  = 0x1D;
const LF  = 0x0A;

export class ESCPOSBuilder {
  constructor({ width = 48 } = {}) { this.width = width; this.buf = []; }
  _raw(...bytes) { for (const b of bytes) this.buf.push(b & 0xFF); return this; }
  _text(str) {
    const clean = String(str ?? '').replace(/₹/g, 'Rs.').replace(/[^\x20-\x7E\n]/g, '?');
    for (const c of clean) this.buf.push(c.charCodeAt(0));
    return this;
  }
  init()           { return this._raw(ESC, 0x40); }
  align(a)         { return this._raw(ESC, 0x61, { left:0, center:1, right:2 }[a] ?? 0); }
  bold(on = true)  { return this._raw(ESC, 0x45, on ? 1 : 0); }
  doubleHeight(on) { return this._raw(ESC, 0x21, on ? 0x10 : 0x00); }
  doubleWidth(on)  { return this._raw(ESC, 0x21, on ? 0x20 : 0x00); }
  size(normal)     { return this._raw(ESC, 0x21, normal ? 0x00 : 0x30); }
  text(str)        { return this._text(str); }
  line(str = '')   { this._text(str); this._raw(LF); return this; }
  feed(n = 1)      { return this._raw(ESC, 0x64, n); }
  cut()            { return this._raw(GS, 0x56, 0x00); }
  hr(char = '-')   { return this.line(char.repeat(this.width)); }
  qr(data, size = 6) {
    const bytes = new TextEncoder().encode(data);
    const len = bytes.length + 3;
    const pL  = len & 0xFF;
    const pH  = (len >> 8) & 0xFF;
    this._raw(GS, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    this._raw(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size);
    this._raw(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);
    this._raw(GS, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (const b of bytes) this._raw(b);
    this._raw(GS, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }
  bytes() { return new Uint8Array(this.buf); }
}

export function padLine(left, right, width = 48) {
  const l = String(left);
  const r = String(right);
  const gap = Math.max(1, width - l.length - r.length);
  return l + ' '.repeat(gap) + r;
}
