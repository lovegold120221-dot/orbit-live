import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { ListenerSession } from '../translator/src/listener-session.mjs';

function listener() {
  const messages = [];
  const directions = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: raw => messages.push(JSON.parse(raw)) };
  const session = new ListenerSession(ws, (parent, source, output, language) => {
    const direction = { source, language, chunks: [], closed: false,
      sendInputPcm16k(chunk) { this.chunks.push(chunk); }, close() { this.closed = true; } };
    directions.push(direction);
    return direction;
  });
  return { session, messages, directions };
}

test('listeners keep their own language and paired transcripts, including shared audio', () => {
  const filipino = listener(), dutch = listener();
  for (const [client, language] of [[filipino, 'fil'], [dutch, 'nl']]) {
    client.session.handle({ event: 'configure', language });
    assert.equal(client.directions.length, 0, 'no provider sessions before audio');
    for (const source of ['alice:mic', 'alice:desktop']) {
      client.session.handle({ event: 'source-start', source, generation: 1 });
      client.session.handle({ event: 'audio', source, generation: 1, pcm16: Buffer.alloc(3200).toString('base64') });
    }
    assert.equal(client.directions.length, 2);
    assert.ok(client.directions.every(d => d.language === language));
  }
  filipino.session.sendTranscript('alice:desktop', { id: 0, original: 'Hello', translated: 'Kumusta', final: false });
  assert.equal(filipino.messages.at(-1).translated, 'Kumusta');
  assert.equal(filipino.messages.at(-1).original, 'Hello');
  assert.equal(dutch.messages.length, 1, 'no transcript crosses listener sockets');
  filipino.session.handle({ event: 'configure', language: 'es' });
  assert.ok(filipino.directions.every(d => d.closed));
  filipino.session.handle({ event: 'audio', generation: 1, source: 'alice:mic', pcm16: 'AAAA' });
  assert.equal(filipino.directions.length, 2, 'old language audio is ignored');
  assert.equal(filipino.messages.at(-1).generation, 2);
  assert.equal(filipino.messages.at(-1).language, 'es');
});

test('source removal, stop, malformed PCM and backpressure release or bound work', () => {
  const { session, directions, messages } = listener();
  session.handle({ event: 'configure', language: 'xx-unsupported' });
  assert.equal(session.language, null);
  session.handle({ event: 'configure', language: 'en' });
  session.handle({ event: 'source-start', source: 'screen', generation: 1 });
  session.handle({ event: 'audio', source: 'screen', generation: 1, pcm16: 'AA==' });
  assert.equal(directions.length, 0);
  session.handle({ event: 'audio', source: 'screen', generation: 1, pcm16: 'AAAAAA==' });
  session.handle({ event: 'source-stop', source: 'screen', generation: 1 });
  assert.ok(directions[0].closed);
  assert.equal(session.sources.size, 0);
  const count = messages.length;
  session.ws.bufferedAmount = 2 * 1024 * 1024;
  session.sendTranslatedPcm('screen', Buffer.alloc(100));
  assert.equal(messages.length, count);
});

for (const sampleRate of [48000, 44100]) {
  test(`worklet preserves duration across 128-frame boundaries at ${sampleRate} Hz and mixes stereo`, () => {
    let Processor;
    const frames = [];
    const context = vm.createContext({ sampleRate, Int16Array, Uint8Array, DataView,
      AudioWorkletProcessor: class { port = { postMessage: bytes => frames.push(bytes) }; },
      registerProcessor: (name, ctor) => { Processor = ctor; }
    });
    vm.runInContext(fs.readFileSync(new URL('../orbit-web/orbit-pcm-worklet.js', import.meta.url), 'utf8'), context);
    const processor = new Processor();
    for (let offset = 0; offset < sampleRate; offset += 128) {
      const length = Math.min(128, sampleRate - offset);
      processor.process([[new Float32Array(length).fill(0.8), new Float32Array(length).fill(0.2)]]);
    }
    assert.equal(frames.length, 10, 'one second must produce exactly ten 100ms frames');
    assert.equal(frames.reduce((sum, b) => sum + b.byteLength, 0), 32000);
    assert.equal(new DataView(frames[0].buffer).getInt16(0, true), 16384);
  });
}
