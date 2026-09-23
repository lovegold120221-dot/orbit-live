import assert from 'node:assert/strict';
import { downsample48kTo16k, upsample24kTo48k } from '../translator/src/audio.mjs';

// 20 ms @ 48 kHz = 960 samples -> 320 samples @ 16 kHz.
const pcm48 = Buffer.alloc(960 * 2);
for (let i = 0; i < 960; i++) pcm48.writeInt16LE(Math.round(Math.sin(i / 10) * 12000), i * 2);
const pcm16 = downsample48kTo16k(pcm48);
assert.equal(pcm16.length, 320 * 2);

// 20 ms @ 24 kHz = 480 samples -> 960 samples @ 48 kHz.
const pcm24 = Buffer.alloc(480 * 2);
for (let i = 0; i < 480; i++) pcm24.writeInt16LE((i % 200) - 100, i * 2);
const up48 = upsample24kTo48k(pcm24);
assert.equal(up48.length, 960 * 2);

console.log('PCM resampling shape checks passed.');
