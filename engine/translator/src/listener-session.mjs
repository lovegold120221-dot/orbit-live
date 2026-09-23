import { normalizeLanguage } from './languages.mjs';

// One private connection per listener. Audio is taken from tracks that this
// listener already receives; transcripts never enter a shared room broadcast.
export class ListenerSession {
  constructor(ws, createDirection) {
    this.ws = ws;
    this.createDirection = createDirection;
    this.sources = new Map();
    this.language = null;
    this.generation = 0;
    this.serial = 0;
  }

  send(message) {
    if (this.ws.readyState === 1 && this.ws.bufferedAmount < 1024 * 1024) {
      this.ws.send(JSON.stringify({ ...message, generation: this.generation, language: this.language }));
    }
  }

  handle(message) {
    if (message.event === 'configure') {
      const language = normalizeLanguage(message.language);
      if (!language) return this.send({ event: 'error', message: 'Choose a supported translation language.' });
      this.close();
      this.generation++;
      this.language = language;
      this.send({ event: 'configured' });
      return;
    }
    if (!this.language || message.generation !== this.generation) return;
    const source = typeof message.source === 'string' ? message.source.slice(0, 200) : '';
    if (!source) return;
    if (message.event === 'source-start') {
      if (this.sources.has(source) || this.sources.size >= 32) return;
      // Create a provider session lazily on the first PCM frame.
      this.sources.set(source, { direction: null, serial: ++this.serial });
    } else if (message.event === 'source-stop') {
      this.sources.get(source)?.direction?.close();
      this.sources.delete(source);
    } else if (message.event === 'audio') {
      const entry = this.sources.get(source);
      if (!entry || typeof message.pcm16 !== 'string' || message.pcm16.length > 9000) return;
      const pcm = Buffer.from(message.pcm16, 'base64');
      if (!pcm.length || pcm.length > 6400 || pcm.length % 2) return;
      entry.direction ||= this.createDirection(this, source, source, this.language);
      entry.direction.sendInputPcm16k(pcm);
    }
  }

  directionStatus(source, state) {
    this.send({ event: 'source-status', source, state });
  }

  sendTranscript(source, transcript) {
    const entry = this.sources.get(source);
    if (!entry) return;
    this.send({ event: 'transcript', source, ...transcript, id: `${entry.serial}:${transcript.id}` });
  }

  sendTranslationTranscript() {} // Legacy bridge callback; paired text is sent above.

  sendTranslatedPcm(source, pcm24) {
    this.send({ event: 'audio', source, pcm: pcm24.toString('base64'), sampleRate: 24000 });
  }

  close() {
    for (const entry of this.sources.values()) entry.direction?.close();
    this.sources.clear();
  }
}
