import http from 'node:http';
import process from 'node:process';
import OpusScript from 'opusscript';
import { WebSocket, WebSocketServer } from 'ws';
import { concatBuffers, downsample48kTo16k, upsample24kTo48k } from './audio.mjs';
import { normalizeLanguage, toGeminiTarget, isGeminiLiveSupported } from './languages.mjs';
import { ListenerSession } from './listener-session.mjs';

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.ORBITAI_API_KEY || process.env.GEMINI_API_KEY || '';
const MODEL = process.env.ORBITAI_TRANSLATION_MODEL || process.env.GEMINI_TRANSLATION_MODEL || 'gemini-3.5-live-translate-preview';
const ECHO_TARGET_LANGUAGE = (process.env.ORBITAI_ECHO_TARGET_LANGUAGE || process.env.GEMINI_ECHO_TARGET_LANGUAGE) !== 'false';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!API_KEY) {
  console.error('[OrbitAI] ORBITAI_API_KEY is required');
  process.exit(1);
}

const GEMINI_WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const INPUT_CHUNK_BYTES = 1600 * 2; // 100 ms, 16 kHz PCM16 mono.
const OUTPUT_OPUS_PCM_BYTES = 960 * 2; // 20 ms, 48 kHz PCM16 mono.
const RTP_TICKS_PER_FRAME = 960;
const TALK_SILENCE_MS = 450;

function log(level, ...args) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] || 20) >= (order[LOG_LEVEL] || 20)) {
    console[level === 'debug' ? 'log' : level](`[${new Date().toISOString()}]`, ...args);
  }
}

function parseRequestTag(request) {
  const idx = request.lastIndexOf('.');
  if (idx <= 0 || idx === request.length - 1) return null;
  const source = request.slice(0, idx);
  const language = normalizeLanguage(request.slice(idx + 1));
  if (!language) return null;
  return { source, language };
}

class GeminiDirection {
  constructor(parent, sourceTag, outputTag, language) {
    this.parent = parent;
    this.sourceTag = sourceTag;
    this.outputTag = outputTag;
    this.language = language;
    this.geminiTarget = toGeminiTarget(language);
    this.ws = null;
    this.ready = false;
    this.closed = false;
    this.pendingInput = [];
    this.pendingInputBytes = 0;
    this.outputPcm48 = Buffer.alloc(0);
    this.encoder = parent.sendTranslatedPcm ? null : new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    this.transcriptId = 0;
    this.original = '';
    this.translated = '';
    this.retryCount = 0;
    this.retryTimer = null;
    this.setupTimer = null;
    this.nextRtpTimestamp = null;
    this.chunk = 0;
    this.talkOpen = false;
    this.talkStartTimestamp = 0;
    this.talkBytes = 0;
    this.talkTimer = null;
    this.projectedPlayoutEndMs = 0;
    if (!isGeminiLiveSupported(language) && !isGeminiLiveSupported(this.geminiTarget)) {
      log('warn', `[OrbitAI] target ${language} is outside the documented Live Translate voice subset; attempting anyway`);
    }
    this.connect();
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(GEMINI_WS, { headers: { 'x-goog-api-key': API_KEY } });
    this.ws = ws;
    this.setupTimer = setTimeout(() => ws.terminate(), 15000);

    ws.on('open', () => {
      // Transcription flags belong at setup level on the v1beta wire API.
      // Verified with setupComplete against the configured translation model.
      // Regional variants (nl-BE Flemish, fr-CA, …) are mapped to the closest
      // Live-supported base so Dutch/Flemish and similar checks pass.
      ws.send(JSON.stringify({
        setup: {
          model: `models/${MODEL}`,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: this.geminiTarget,
              echoTargetLanguage: ECHO_TARGET_LANGUAGE
            }
          },
          contextWindowCompression: {
            triggerTokens: '0',
            slidingWindow: { targetTokens: '0' }
          }
        }
      }));
      log('info', `[OrbitAI] direction opened ${this.sourceTag} -> ${this.language} (gemini:${this.geminiTarget})`);
    });

    ws.on('message', raw => {
      if (this.closed || this.ws !== ws) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.setupComplete) {
        clearTimeout(this.setupTimer);
        this.ready = true;
        this.retryCount = 0;
        this.parent.directionStatus?.(this.sourceTag, 'ready');
        this.flushPendingInput();
      }
      if (msg.error) this.parent.directionStatus?.(this.sourceTag, 'error');
      const content = msg.serverContent;
      if (!content) return;
      if (content.inputTranscription?.text) this.original += content.inputTranscription.text;
      if (content.outputTranscription?.text) {
        this.translated += content.outputTranscription.text;
        this.parent.sendTranslationTranscript(this.sourceTag, this.language, content.outputTranscription.text);
      }
      if (content.inputTranscription?.text || content.outputTranscription?.text || content.turnComplete) {
        this.parent.sendTranscript?.(this.sourceTag, {
          id: this.transcriptId, original: this.original, translated: this.translated,
          language: this.language, final: Boolean(content.turnComplete),
          sourceLanguage: content.inputTranscription?.languageCode
        });
      }
      if (content.interrupted) {
        this.outputPcm48 = Buffer.alloc(0);
        this.parent.directionStatus?.(this.sourceTag, 'interrupted');
      }
      const parts = content.modelTurn?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) {
          this.handleTranslatedPcm(Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      // Live Translate is continuous and may never send turnComplete. Bound
      // each paired transcript without discarding the visible history.
      if (content.turnComplete || this.original.length + this.translated.length > 1800) this.finishTranscript();
    });

    ws.on('error', error => {
      log('error', `[OrbitAI] websocket error ${this.sourceTag}/${this.language}: ${error.message}`);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(this.setupTimer);
      this.ready = false;
      if (!this.closed) this.finishTranscript();
      log('warn', `[OrbitAI] direction closed ${this.sourceTag}/${this.language}: ${code} ${reason?.toString() || ''}`);
      if (!this.closed) {
        const permanent = [1007, 1008].includes(code);
        this.parent.directionStatus?.(this.sourceTag, permanent ? 'error' : 'reconnecting');
        if (!permanent) this.retryTimer = setTimeout(() => this.connect(), Math.min(30000, 750 * 2 ** this.retryCount++));
      }
    });
  }

  finishTranscript() {
    if (this.original || this.translated) this.parent.sendTranscript?.(this.sourceTag, {
      id: this.transcriptId, original: this.original, translated: this.translated,
      language: this.language, final: true
    });
    this.transcriptId++;
    this.original = '';
    this.translated = '';
  }

  sendInputPcm16k(chunk) {
    if (this.closed) return;
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingInput.push(Buffer.from(chunk));
      this.pendingInputBytes += chunk.length;
      while (this.pendingInputBytes > INPUT_CHUNK_BYTES * 20 && this.pendingInput.length) {
        this.pendingInputBytes -= this.pendingInput.shift().length;
      }
      return;
    }
    this.ws.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: chunk.toString('base64'),
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    }));
  }

  flushPendingInput() {
    for (const chunk of this.pendingInput) this.sendInputPcm16k(chunk);
    this.pendingInput = [];
    this.pendingInputBytes = 0;
  }

  handleTranslatedPcm(pcm24) {
    if (this.parent.sendTranslatedPcm) {
      this.parent.sendTranslatedPcm(this.sourceTag, pcm24);
      return;
    }
    this.outputPcm48 = concatBuffers(this.outputPcm48, upsample24kTo48k(pcm24));
    while (this.outputPcm48.length >= OUTPUT_OPUS_PCM_BYTES) {
      const frame = this.outputPcm48.subarray(0, OUTPUT_OPUS_PCM_BYTES);
      this.outputPcm48 = this.outputPcm48.subarray(OUTPUT_OPUS_PCM_BYTES);
      const opus = Buffer.from(this.encoder.encode(frame, 960));
      this.emitOpus(opus);
    }
  }

  emitOpus(opus) {
    if (this.nextRtpTimestamp === null) {
      this.nextRtpTimestamp = this.parent.lastInputTimestamp.get(this.sourceTag) ?? ((Date.now() * 48) >>> 0);
    }
    if (!this.talkOpen) {
      this.talkOpen = true;
      this.talkStartTimestamp = this.nextRtpTimestamp;
      this.talkBytes = 0;
      this.parent.send({
        event: 'start',
        sequenceNumber: this.parent.nextSequence(),
        start: {
          tag: this.outputTag,
          mediaFormat: { encoding: 'opus', sampleRate: 48000, channels: 1 },
          timestamp: this.nextRtpTimestamp
        }
      });
    }

    this.parent.send({
      event: 'media',
      sequenceNumber: this.parent.nextSequence(),
      media: {
        tag: this.outputTag,
        chunk: this.chunk++,
        timestamp: this.nextRtpTimestamp,
        payload: opus.toString('base64')
      }
    });
    this.talkBytes += opus.length;
    this.nextRtpTimestamp = (this.nextRtpTimestamp + RTP_TICKS_PER_FRAME) >>> 0;

    // Gemini can deliver audio faster than wall-clock. Keep the source marked as
    // sending until the emitted RTP burst would actually finish playing, plus a
    // short silence tail. This mirrors Jitsi's own translator-proxy behavior.
    const now = Date.now();
    this.projectedPlayoutEndMs = Math.max(this.projectedPlayoutEndMs, now) + 20;
    clearTimeout(this.talkTimer);
    const stopDelay = Math.max(0, this.projectedPlayoutEndMs - now) + TALK_SILENCE_MS;
    this.talkTimer = setTimeout(() => this.endTalk(), stopDelay);
  }

  endTalk() {
    if (!this.talkOpen) return;
    const start = this.talkStartTimestamp >>> 0;
    const end = this.nextRtpTimestamp >>> 0;
    const ticks = (end - start) >>> 0;
    this.parent.send({
      event: 'stop',
      sequenceNumber: this.parent.nextSequence(),
      stop: {
        tag: this.outputTag,
        timestamp: end,
        mediaInfo: {
          bytesSent: this.talkBytes,
          duration: Math.round((ticks / 48000) * 1000)
        }
      }
    });
    this.talkOpen = false;
    this.talkBytes = 0;
    this.projectedPlayoutEndMs = 0;
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.setupTimer);
    this.finishTranscript();
    clearTimeout(this.talkTimer);
    this.endTalk();
    try { this.ws?.close(1000, 'translation no longer requested'); } catch {}
    try { this.encoder?.delete?.(); } catch {}
  }
}

class SourcePipeline {
  constructor(parent, sourceTag) {
    this.parent = parent;
    this.sourceTag = sourceTag;
    this.decoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    this.pcm16k = Buffer.alloc(0);
    this.directions = new Map();
  }

  ensureDirection(language, outputTag) {
    if (!this.directions.has(language)) {
      this.directions.set(language, new GeminiDirection(this.parent, this.sourceTag, outputTag, language));
    }
  }

  removeDirection(language) {
    const direction = this.directions.get(language);
    if (direction) direction.close();
    this.directions.delete(language);
  }

  handleOpus(payload) {
    if (!this.directions.size) return;
    let pcm48;
    try {
      pcm48 = Buffer.from(this.decoder.decode(Buffer.from(payload, 'base64')));
    } catch (error) {
      log('warn', `Opus decode failed for ${this.sourceTag}: ${error.message}`);
      return;
    }
    this.pcm16k = concatBuffers(this.pcm16k, downsample48kTo16k(pcm48));
    while (this.pcm16k.length >= INPUT_CHUNK_BYTES) {
      const chunk = this.pcm16k.subarray(0, INPUT_CHUNK_BYTES);
      this.pcm16k = this.pcm16k.subarray(INPUT_CHUNK_BYTES);
      for (const direction of this.directions.values()) direction.sendInputPcm16k(chunk);
    }
  }

  close() {
    for (const direction of this.directions.values()) direction.close();
    this.directions.clear();
    try { this.decoder?.delete?.(); } catch {}
  }
}

class BridgeSession {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    this.sequence = 0;
    this.transcriptSeq = 0;
    this.sources = new Map();
    this.lastInputTimestamp = new Map();
    this.send({ event: 'info', application: 'orbit-ai-live-translator', version: '2.0.0', provider: 'OrbitAI', modelAlias: 'OrbitAI Live' });
  }

  nextSequence() { return this.sequence++; }

  send(obj) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendTranslationTranscript(source, language, text) {
    if (!text?.trim()) return;
    this.send({
      event: 'transcription-result',
      type: 'realtime-translation-result',
      is_interim: true,
      transcript: [{ text }],
      language,
      message_id: `orbitai-${source}-${this.transcriptSeq++}`,
      participant: { id: source },
      timestamp: Date.now()
    });
  }

  reconcile(exportsValue, requestsValue) {
    const exportsList = Array.isArray(exportsValue) ? exportsValue.filter(v => typeof v === 'string') : [];
    const requests = Array.isArray(requestsValue) ? requestsValue.filter(v => typeof v === 'string') : [];
    const desired = new Map();

    for (const request of requests) {
      const parsed = parseRequestTag(request);
      if (!parsed) {
        log('warn', `Ignoring unsupported translation request: ${request}`);
        continue;
      }
      if (exportsList.length && !exportsList.includes(parsed.source)) {
        log('warn', `Request ${request} references source not in exports`);
      }
      if (!desired.has(parsed.source)) desired.set(parsed.source, new Map());
      desired.get(parsed.source).set(parsed.language, request);
    }

    for (const [sourceTag, pipeline] of this.sources) {
      const wanted = desired.get(sourceTag) || new Map();
      for (const language of [...pipeline.directions.keys()]) {
        if (!wanted.has(language)) pipeline.removeDirection(language);
      }
      if (!wanted.size && !exportsList.includes(sourceTag)) {
        pipeline.close();
        this.sources.delete(sourceTag);
      }
    }

    for (const [sourceTag, langs] of desired) {
      let pipeline = this.sources.get(sourceTag);
      if (!pipeline) {
        pipeline = new SourcePipeline(this, sourceTag);
        this.sources.set(sourceTag, pipeline);
      }
      for (const [language, outputTag] of langs) pipeline.ensureDirection(language, outputTag);
    }

    log('info', `Bridge session ${this.id}: ${requests.length} requested translated source(s)`);
  }

  handle(msg) {
    switch (msg?.event) {
      case 'ping':
        this.send({ event: 'pong', ...(Number.isFinite(msg.id) ? { id: msg.id } : {}) });
        break;
      case 'sources':
        this.reconcile(msg.exports, msg.requests);
        break;
      case 'media': {
        const sourceTag = msg.media?.tag;
        if (typeof sourceTag !== 'string') break;
        if (Number.isFinite(msg.media?.timestamp)) this.lastInputTimestamp.set(sourceTag, msg.media.timestamp >>> 0);
        this.sources.get(sourceTag)?.handleOpus(msg.media?.payload || '');
        break;
      }
      case 'info':
        log('debug', `JVB info: ${JSON.stringify(msg)}`);
        break;
    }
  }

  close() {
    for (const pipeline of this.sources.values()) pipeline.close();
    this.sources.clear();
  }
}

// ---------------------------------------------------------------------------
// Screen-share audio hub.
//
// Upstream Jicofo/JVB only export each sender's FIRST (mic) audio source to
// the translator, so desktop audio shared in a meeting never reaches the
// bridge path above. This hub covers it directly: the SHARER's browser
// captures its desktop-audio track, downsamples to 16 kHz PCM and publishes
// 100 ms chunks here; each LISTENER language gets one shared GeminiDirection
// (reusing the pipeline above, so no per-listener Gemini cost duplication
// beyond languages actually subscribed). Translated Opus is decoded back to
// PCM48 in-process and broadcast to that language's subscribers, with
// talk-state for ducking the original screen audio and live captions.
// Same-origin only (served through the web container's /api/screen/ proxy),
// scoped per meeting room. No Gemini session starts until a listener
// subscribes, so idle meetings cost nothing.
// ---------------------------------------------------------------------------
class ScreenHub {
  constructor(meeting) {
    this.meeting = meeting;
    this.sourceTag = `screen:${meeting}`;
    this.sequence = 0;
    this.directions = new Map(); // language -> GeminiDirection
    this.tagLanguage = new Map(); // outputTag -> language
    this.subscribers = new Map(); // language -> Set<ws>
    this.lastInputTimestamp = new Map();
    this.decoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    this.publisher = null;
    this.lastActivity = Date.now();
  }

  nextSequence() { return this.sequence++; }

  touch() { this.lastActivity = Date.now(); }

  ensureDirection(language) {
    if (!this.directions.has(language)) {
      const outputTag = `${this.sourceTag}.${language}`;
      this.tagLanguage.set(outputTag, language);
      this.directions.set(language, new GeminiDirection(this, this.sourceTag, outputTag, language));
      log('info', `[OrbitAI] screen hub ${this.meeting}: direction opened -> ${language}`);
    }
  }

  subscribe(ws, language) {
    this.touch();
    this.ensureDirection(language);
    if (!this.subscribers.has(language)) this.subscribers.set(language, new Set());
    this.subscribers.get(language).add(ws);
  }

  unsubscribe(ws) {
    let changed = false;
    for (const set of this.subscribers.values()) {
      if (set.delete(ws)) changed = true;
    }
    if (changed) this.pruneDirections();
    return changed;
  }

  pruneDirections() {
    for (const [language, direction] of this.directions) {
      if (!this.subscribers.get(language)?.size) {
        direction.close();
        this.directions.delete(language);
      }
    }
  }

  feedPcm16k(chunk) {
    this.touch();
    if (!this.directions.size) return;
    for (const direction of this.directions.values()) direction.sendInputPcm16k(chunk);
  }

  broadcast(language, obj) {
    const text = JSON.stringify(obj);
    for (const ws of this.subscribers.get(language) || []) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(text); } catch {}
      }
    }
  }

  send(obj) {
    if (obj?.event === 'media') {
      const language = this.tagLanguage.get(obj.media?.tag);
      if (!language) return;
      let pcm48;
      try {
        pcm48 = Buffer.from(this.decoder.decode(Buffer.from(obj.media?.payload || '', 'base64')));
      } catch (error) {
        log('warn', `[OrbitAI] screen hub ${this.meeting}: opus decode failed: ${error.message}`);
        return;
      }
      this.broadcast(language, { event: 'screen-audio', pcm48: pcm48.toString('base64'), sampleRate: 48000 });
      return;
    }
    if (obj?.event === 'start' || obj?.event === 'stop') {
      const language = this.tagLanguage.get(obj.start?.tag || obj.stop?.tag);
      if (!language) return;
      this.broadcast(language, { event: 'screen-talk', active: obj.event === 'start' });
      return;
    }
  }

  sendTranslationTranscript(source, language, text) {
    if (!text?.trim()) return;
    this.broadcast(language, { event: 'screen-transcript', text, language });
  }

  subscriberCount() {
    let n = 0;
    for (const set of this.subscribers.values()) n += set.size;
    return n;
  }

  destroy() {
    for (const direction of this.directions.values()) direction.close();
    this.directions.clear();
    this.subscribers.clear();
    try { this.decoder?.delete?.(); } catch {}
  }

  get idle() {
    return !this.publisher && this.subscriberCount() === 0;
  }
}

const screenHubs = new Map(); // meeting -> ScreenHub

function getScreenHub(meeting) {
  let hub = screenHubs.get(meeting);
  if (!hub) {
    hub = new ScreenHub(meeting);
    screenHubs.set(meeting, hub);
  }
  return hub;
}

setInterval(() => {
  for (const [meeting, hub] of screenHubs) {
    if (hub.idle && Date.now() - hub.lastActivity > 60000) {
      hub.destroy();
      screenHubs.delete(meeting);
      log('info', `[OrbitAI] screen hub ${meeting}: reaped idle hub`);
    }
  }
}, 30000).unref();

function handleScreenSocket(ws) {
  let hub = null;
  let isPublisher = false;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.event === 'screen-join') {
      const meeting = String(msg.meeting || '').slice(0, 160) || 'lobby';
      hub = getScreenHub(meeting);
      if (msg.role === 'publisher') {
        if (hub.publisher && hub.publisher !== ws) {
          try { hub.publisher.close(1000, 'superseded'); } catch {}
        }
        hub.publisher = ws;
        isPublisher = true;
        hub.touch();
        log('info', `[OrbitAI] screen hub ${meeting}: publisher attached`);
      } else {
        const language = normalizeLanguage(msg.language) || 'en';
        hub.subscribe(ws, language);
        log('info', `[OrbitAI] screen hub ${meeting}: subscriber attached -> ${language}`);
      }
      return;
    }
    if (msg?.event === 'screen-pcm' && isPublisher && hub && hub.publisher === ws) {
      const chunk = Buffer.from(String(msg.pcm16 || ''), 'base64');
      if (chunk.length && chunk.length <= 6400) hub.feedPcm16k(chunk);
      return;
    }
    if (msg?.event === 'screen-language' && hub) {
      const language = normalizeLanguage(msg.language);
      if (language) {
        hub.unsubscribe(ws);
        hub.subscribe(ws, language);
      }
    }
  });
  ws.on('close', () => {
    isPublisher = false;
    if (!hub) return;
    if (hub.publisher === ws) {
      hub.publisher = null;
      hub.touch();
    }
    hub.unsubscribe(ws);
  });
  ws.on('error', error => log('warn', `[OrbitAI] screen socket error: ${error.message}`));
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL }));
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('WebSocket upgrade required');
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
let connectionId = 0;

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/live/')) {
    let allowedOrigin = true;
    try { allowedOrigin = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host; }
    catch { allowedOrigin = false; }
    if (!allowedOrigin) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const session = new ListenerSession(ws, (...args) => new GeminiDirection(...args));
      ws.on('message', raw => {
        try { session.handle(JSON.parse(raw.toString())); }
        catch { session.send({ event: 'error', message: 'Invalid translation request.' }); }
      });
      const heartbeat = setInterval(() => ws.ping(), 20000);
      ws.on('close', () => { clearInterval(heartbeat); session.close(); });
      ws.on('error', () => ws.close());
    });
    return;
  }
  if (url.pathname.startsWith('/screen/')) {
    wss.handleUpgrade(req, socket, head, ws => handleScreenSocket(ws));
    return;
  }
  if (!url.pathname.includes('/translate')) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => {
    const session = new BridgeSession(ws, ++connectionId);
    ws.on('message', raw => {
      try { session.handle(JSON.parse(raw.toString())); } catch (error) { log('warn', `Bad JVB message: ${error.message}`); }
    });
    ws.on('close', () => session.close());
    ws.on('error', error => log('warn', `JVB websocket error: ${error.message}`));
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  log('info', `[OrbitAI] translator listening on :${PORT}`);
  log('info', '[OrbitAI] live translation backend ready');
});

function shutdown() {
  log('info', '[OrbitAI] shutting down translator');
  for (const client of wss.clients) {
    try { client.close(1001, 'server shutdown'); } catch {}
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
