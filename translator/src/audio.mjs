export function concatBuffers(a, b) {
  if (!a?.length) return Buffer.from(b);
  if (!b?.length) return Buffer.from(a);
  return Buffer.concat([a, b]);
}

// PCM16 LE 48 kHz mono -> 16 kHz mono. Exact 3:1 conversion using averaged groups.
export function downsample48kTo16k(input) {
  const samples = Math.floor(input.length / 2);
  const outSamples = Math.floor(samples / 3);
  const out = Buffer.allocUnsafe(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const a = input.readInt16LE((i * 3) * 2);
    const b = input.readInt16LE((i * 3 + 1) * 2);
    const c = input.readInt16LE((i * 3 + 2) * 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((a + b + c) / 3))), i * 2);
  }
  return out;
}

// PCM16 LE 24 kHz mono -> 48 kHz mono, linear interpolation.
export function upsample24kTo48k(input) {
  const samples = Math.floor(input.length / 2);
  if (!samples) return Buffer.alloc(0);
  const out = Buffer.allocUnsafe(samples * 4);
  for (let i = 0; i < samples; i++) {
    const current = input.readInt16LE(i * 2);
    const next = i + 1 < samples ? input.readInt16LE((i + 1) * 2) : current;
    out.writeInt16LE(current, (i * 2) * 2);
    out.writeInt16LE(Math.round((current + next) / 2), (i * 2 + 1) * 2);
  }
  return out;
}
