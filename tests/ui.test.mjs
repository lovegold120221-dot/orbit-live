import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const clientScript = fs.readFileSync(new URL('../orbit-web/orbit-translator-client.js', import.meta.url), 'utf8');
const uiScript = fs.readFileSync(new URL('../orbit-web/orbit-live-translation.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function track(id, { local = false, screen = false, muted = false } = {}) {
  const media = { id, readyState: 'live', enabled: true, stop() { throw new Error('Meeting tracks must not be stopped'); } };
  return { media, getTrack: () => media, isAudioTrack: () => true, isMuted: () => muted,
    getVideoType: () => screen ? 'desktop' : undefined, isLocal: () => local };
}

function fixture() {
  const dom = new JSDOM('<!doctype html><body><div class="participants_pane"></div><div class="toolbox-content-items"></div></body>',
    { url: 'https://orbit.test/Meeting', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const sockets = [];
  const nodes = [];
  class Node {
    port = {};
    gain = { value: 1 };
    connect() { return this; }
    disconnect() { this.disconnected = true; }
    start(time) { this.startTime = time; }
    stop() { this.stopped = true; }
    constructor() { nodes.push(this); }
  }
  class Context {
    state = 'running';
    currentTime = 1;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaStreamSource() { return new Node(); }
    createGain() { return new Node(); }
    createBuffer(channels, samples, rate) {
      return { duration: samples / rate, getChannelData: () => new Float32Array(samples) };
    }
    createBufferSource() { return new Node(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    constructor(url) { this.url = url; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  const local = track('local-mic', { local: true });
  const remote = track('remote-mic');
  const screen = track('screen-audio', { screen: true });
  let tracks = [remote, screen];
  let joined = true;
  const conference = { getName: () => 'meeting', isJoined: () => joined,
    getLocalTracks: () => [local],
    getParticipants: () => [{ getId: () => 'alice', getDisplayName: () => 'Alice', getTracks: () => tracks }],
    setReceiverTranslationLanguage: language => assert.equal(language, null) };
  window.AudioContext = Context;
  window.AudioWorkletNode = Node;
  window.MediaStream = class { constructor(t) { this.tracks = t; } };
  window.WebSocket = Socket;
  window.APP = { conference: { _room: conference } };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { width: 320, height: 400, top: 650, bottom: 1050, right: 1024 };
  };
  window.eval(clientScript);
  return { dom, window, conference, sockets, nodes, remote,
    setTracks: value => { tracks = value; }, leave: () => { joined = false; } };
}

test('listener captures mic and screen tracks, selects its language and cleans up on switch/stop', async () => {
  const f = fixture();
  try {
    const rows = [];
    const client = new f.window.OrbitTranslatorClient({ onStatus() {}, onTranscript: row => rows.push(row), onReset() {} });
    client.start(f.conference, 'fil');
    await tick();
    const ws = f.sockets[0];
    ws.onopen();
    assert.equal(ws.sent[0].language, 'fil');
    ws.receive({ event: 'configured', generation: 1, language: 'fil' });
    assert.equal(client.session.sources.size, 3, 'local mic, remote mic, shared audio');
    assert.equal(ws.sent.filter(m => m.event === 'source-start').length, 3);
    for (const source of client.session.sources.values()) source.worklet.port.onmessage({ data: new Uint8Array(3200) });
    assert.equal(ws.sent.filter(m => m.event === 'audio').length, 3);
    ws.receive({ event: 'transcript', generation: 1, language: 'nl', source: 'alice:screen-audio', original: 'Hello', translated: 'Hallo' });
    assert.equal(rows.length, 0);
    ws.receive({ event: 'transcript', generation: 1, language: 'fil', source: 'alice:screen-audio', original: 'Hello', translated: 'Kumusta' });
    assert.equal(rows[0].kind, 'Shared audio');
    assert.equal(rows[0].name, 'Alice');
    f.setTracks([f.remote]);
    client.sync(client.session);
    assert.equal(client.session.sources.size, 2);
    assert.ok(ws.sent.some(m => m.event === 'source-stop' && m.source === 'alice:screen-audio'));
    const oldSession = client.session;
    client.start(f.conference, 'nl');
    await tick();
    assert.equal(oldSession.ctx.state, 'closed');
    assert.equal(ws.readyState, 3);
    assert.equal(client.session.language, 'nl');
    f.leave();
    client.sync(client.session);
    assert.equal(client.session, null);
  } finally { f.dom.window.close(); }
});

test('translated audio restores original volume on stop and cancels queued playback', async () => {
  const f = fixture();
  try {
    const client = new f.window.OrbitTranslatorClient({ onStatus() {}, onTranscript() {}, onReset() {} });
    client.start(f.conference, 'fil');
    await tick();
    const ws = f.sockets[0];
    ws.onopen();
    ws.receive({ event: 'configured', generation: 1, language: 'fil' });
    const element = f.window.document.createElement('audio');
    element.srcObject = { getAudioTracks: () => [f.remote.media] };
    element.volume = 0.6;
    f.window.document.body.append(element);
    const audio = { event: 'audio', generation: 1, language: 'fil', source: 'alice:remote-mic', pcm: Buffer.alloc(4800).toString('base64'), sampleRate: 24000 };
    ws.receive(audio);
    assert.equal(element.volume, 0);
    const session = client.session;
    const playback = session.playing.get(audio.source);
    const queued = [...playback.nodes];
    ws.receive({ ...audio, source: 'local:local-mic' });
    assert.equal(session.playing.size, 1, 'local speech is text only');
    client.stop();
    assert.equal(element.volume, 0.6);
    assert.ok(queued.every(node => node.stopped && node.disconnected));
    assert.equal(session.playing.size, 0);
    assert.equal(session.sources.size, 0);
  } finally { f.dom.window.close(); }
});

test('muted microphones are excluded while a participant sharing mixed audio remains captured', async () => {
  const f = fixture();
  try {
    const muted = track('muted', { muted: true });
    f.setTracks([muted]);
    const client = new f.window.OrbitTranslatorClient({ onStatus() {}, onTranscript() {}, onReset() {} });
    client.start(f.conference, 'en');
    await tick();
    f.sockets[0].onopen();
    f.sockets[0].receive({ event: 'configured', generation: 1, language: 'en' });
    assert.equal(client.session.sources.size, 1, 'only local unmuted mic');
    f.setTracks([muted, { isAudioTrack: () => false, getVideoType: () => 'desktop' }]);
    client.sync(client.session);
    assert.equal(client.session.sources.size, 2, 'mixed shared audio remains available with a muted mic');
    client.stop();
  } finally { f.dom.window.close(); }
});

test('sidebar shows paired transcript history, escapes content, and clears old language on change', async () => {
  const f = fixture();
  try {
    f.window.localStorage.setItem('orbit.translation.targetLanguage', 'fil');
    f.window.eval(uiScript);
    await tick();
    await tick();
    const ws = f.sockets.find(s => s.url.includes('/api/live/'));
    assert.ok(ws, 'saved preference starts without needing to open participants');
    ws.onopen();
    ws.receive({ event: 'configured', generation: 1, language: 'fil' });
    const row = { event: 'transcript', generation: 1, language: 'fil', source: 'alice:screen-audio', id: '1:0', original: '<img src=x onerror=alert(1)> Hello', translated: 'Kumusta' };
    ws.receive(row);
    ws.receive({ ...row, translated: 'Kumusta po' });
    const history = f.window.document.querySelector('#orbit-translator-panel .orbit-transcripts');
    assert.match(history.textContent, /Original transcript/);
    assert.match(history.textContent, /Kumusta po/);
    assert.match(history.textContent, /Translation · Filipino/);
    assert.equal(history.querySelectorAll('article').length, 1, 'streaming fragments update a stable row');
    assert.equal(history.querySelectorAll('img').length, 0, 'transcripts cannot inject HTML');
    assert.match(f.window.document.querySelector('#orbit-live-translation-card').textContent, /Kumusta po/);
    const select = f.window.document.getElementById('orbit-panel-language-select');
    select.value = 'nl';
    select.dispatchEvent(new f.window.Event('change'));
    await tick();
    assert.equal(history.querySelectorAll('article').length, 0);
    assert.equal(f.window.localStorage.getItem('orbit.translation.targetLanguage'), 'nl');
    const stop = f.window.document.getElementById('orbit-start-translation-button');
    stop.click();
    assert.equal(f.window.localStorage.getItem('orbit.translation.targetLanguage'), null);
    assert.equal(stop.textContent, 'Start Live Translator');
  } finally { f.dom.window.close(); }
});
