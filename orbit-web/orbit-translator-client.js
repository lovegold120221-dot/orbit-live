(() => {
  'use strict';

  function collectTracks(conference) {
    const sources = new Map();
    const participants = conference.getParticipants?.() || [];
    const groups = [{ id: 'local', name: 'You', local: true, tracks: conference.getLocalTracks?.() || [] },
      ...participants.map(p => ({ id: p.getId(), name: p.getDisplayName?.() || 'Participant', local: false, tracks: p.getTracks?.() || [] }))];
    for (const group of groups) {
      const sharing = group.tracks.some(t => t.getVideoType?.() === 'desktop');
      for (const track of group.tracks) {
        if (!track.isAudioTrack?.()) continue;
        // Jitsi can mix shared audio into the outgoing mic stream. Read the
        // current track every time so starting/stopping that effect is noticed.
        const media = track.getTrack?.();
        if (!media || media.readyState === 'ended' || media.enabled === false) continue;
        if (track.isMuted?.() && !sharing) continue;
        const screen = track.getVideoType?.() === 'desktop';
        const source = `${group.id}:${media.id}`;
        sources.set(source, { source, media, track, local: group.local,
          name: group.name, kind: screen ? 'Shared audio' : sharing ? 'Microphone / shared audio' : 'Microphone' });
      }
    }
    return sources;
  }

  function base64(bytes) {
    let value = '';
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value);
  }

  class OrbitTranslatorClient {
    constructor({ onStatus, onTranscript, onReset }) {
      this.onStatus = onStatus;
      this.onTranscript = onTranscript;
      this.onReset = onReset;
      this.session = null;
    }

    status(text, state = 'connecting') { this.onStatus(text, state); }

    start(conference, language) {
      if (this.session?.conference === conference && this.session.language === language) {
        this.resume();
        return;
      }
      this.stop();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !window.AudioWorkletNode) {
        this.status('Live translation needs a browser with Web Audio on HTTPS or localhost.', 'error');
        return;
      }
      const ctx = new Ctx();
      const session = { conference, language, ctx, sources: new Map(), playing: new Map(), ducked: new Map(),
        ws: null, generation: 0, connection: 0, retry: 0, timer: null, retryTimer: null, ready: false };
      this.session = session;
      this.onReset();
      // This is called from the Start/language click to unlock audio playback.
      this.resume();
      this.status('Connecting Live Translator…');
      ctx.audioWorklet.addModule('/orbit-pcm-worklet.js?v=10').then(() => {
        if (this.session !== session) return;
        this.connect(session);
        session.timer = setInterval(() => this.sync(session), 500);
      }).catch(() => {
        if (this.session === session) {
          this.stop();
          this.status('Audio capture could not start. Reload the meeting and try again.', 'error');
        }
      });
    }

    resume() {
      const ctx = this.session?.ctx;
      if (ctx?.state === 'suspended') ctx.resume().catch(() => {
        this.status('Tap Start or the translator panel to enable audio.', 'connecting');
      });
    }

    connect(session) {
      if (this.session !== session) return;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const room = session.conference.getName?.() || 'meeting';
      const ws = new WebSocket(`${scheme}//${location.host}/api/live/${encodeURIComponent(room)}`);
      session.connection++;
      session.ws = ws;
      ws.onopen = () => {
        if (this.session !== session) return ws.close();
        ws.send(JSON.stringify({ event: 'configure', language: session.language }));
      };
      ws.onmessage = event => {
        if (this.session !== session || session.ws !== ws) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.event === 'configured') {
          session.generation = message.generation;
          session.ready = true;
          session.retry = 0;
          this.sync(session);
          return;
        }
        if (message.generation !== session.generation || message.language !== session.language) return;
        const source = session.sources.get(message.source);
        if (message.event === 'error') return this.status(message.message, 'error');
        if (!source) return;
        if (message.event === 'transcript') {
          this.onTranscript({ ...message, id: `${session.connection}:${message.id}`, name: source.name, kind: source.kind });
        } else if (message.event === 'audio') {
          // Your own mic stays text-only so you don't hear yourself back, but
          // shared screen audio is played even locally so the TTS is heard.
          if (!source.local || source.kind !== 'Microphone') this.play(session, source, message);
        } else if (message.event === 'source-status') {
          source.state = message.state;
          if (['interrupted', 'error', 'reconnecting'].includes(message.state)) this.clearPlayback(session, source.source);
          this.updateStatus(session);
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (this.session !== session || session.ws !== ws) return;
        session.ready = false;
        for (const key of [...session.sources.keys()]) this.removeSource(session, key);
        this.status('Translation disconnected. Reconnecting…');
        session.retryTimer = setTimeout(() => this.connect(session), Math.min(15000, 500 * 2 ** session.retry++));
      };
    }

    send(session, message) {
      if (session.ready && session.ws?.readyState === WebSocket.OPEN && session.ws.bufferedAmount < 256 * 1024) {
        session.ws.send(JSON.stringify({ ...message, generation: session.generation }));
      }
    }

    sync(session) {
      if (this.session !== session) return;
      if (!session.conference.isJoined?.()) { this.stop(); return; }
      if (!session.ready) return;
      const wanted = collectTracks(session.conference);
      for (const [key, source] of session.sources) {
        if (wanted.get(key)?.media !== source.media) this.removeSource(session, key);
      }
      for (const [key, info] of wanted) {
        if (session.sources.has(key)) {
          Object.assign(session.sources.get(key), info);
          continue;
        }
        try {
          const input = session.ctx.createMediaStreamSource(new MediaStream([info.media]));
          const worklet = new AudioWorkletNode(session.ctx, 'orbit-pcm16');
          const silent = session.ctx.createGain();
          silent.gain.value = 0;
          const source = { ...info, input, worklet, silent, state: 'connecting' };
          session.sources.set(key, source);
          this.send(session, { event: 'source-start', source: key });
          worklet.port.onmessage = ({ data }) => {
            if (this.session !== session || session.sources.get(key) !== source) return;
            // Robust separation: never feed the mic while translated audio is
            // still playing (plus hangover). Speaker output picked up
            // acoustically would otherwise be re-translated in a loop.
            // Remote RTC tracks are clean and always forwarded.
            if (source.local && session.ctx.currentTime < (session.micGateUntil || 0)) return;
            this.send(session, { event: 'audio', source: key, pcm16: base64(data) });
          };
          // A connected, silent destination keeps the worklet processing.
          input.connect(worklet).connect(silent).connect(session.ctx.destination);
        } catch {
          this.status('A meeting audio track could not be captured.', 'error');
        }
      }
      this.updateStatus(session);
    }

    updateStatus(session) {
      if (session.ctx.state === 'suspended') return this.status('Tap the translator panel to enable audio.');
      const sources = [...session.sources.values()];
      if (!sources.length) return this.status('Waiting for microphone or shared audio…', 'active');
      if (sources.some(s => s.state === 'error')) return this.status('The translation provider rejected an audio session. Stop and restart to retry.', 'error');
      if (sources.some(s => s.state === 'reconnecting')) return this.status('Reconnecting an audio source…');
      if (sources.every(s => s.state === 'connecting')) return this.status('Connecting audio sources…');
      this.status(`Live · ${sources.length} audio source${sources.length === 1 ? '' : 's'}`, 'active');
    }

    removeSource(session, key) {
      const source = session.sources.get(key);
      if (!source) return;
      this.send(session, { event: 'source-stop', source: key });
      source.worklet.port.onmessage = null;
      for (const node of [source.input, source.worklet, source.silent]) node.disconnect();
      // Never stop a meeting-owned MediaStreamTrack.
      session.sources.delete(key);
      this.clearPlayback(session, key);
    }

    duck(session, source) {
      for (const element of document.querySelectorAll('audio, video')) {
        const tracks = element.srcObject?.getAudioTracks?.() || [];
        if (!tracks.some(t => t.id === source.media.id)) continue;
        if (!session.ducked.has(element)) session.ducked.set(element, { volume: element.volume, source: source.source });
        element.volume = 0;
      }
    }

    restore(session, key) {
      for (const [element, value] of session.ducked) {
        if (value.source !== key) continue;
        element.volume = value.volume;
        session.ducked.delete(element);
      }
    }

    play(session, source, message) {
      const ctx = session.ctx;
      // Don't silently drop audio when autoplay policy suspends the context.
      // Queue anyway and try to resume so the user hears buffered speech.
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        ctx.resume?.().catch(() => {});
      }
      let binary = '';
      try { binary = atob(message.pcm); } catch { return; }
      if (!binary.length || binary.length % 2 || message.sampleRate !== 24000) return;
      let playback = session.playing.get(source.source);
      if (!playback) {
        playback = { next: 0, nodes: new Set(), timer: null };
        session.playing.set(source.source, playback);
      }
      // Never overlap old queued chunks after a stall. Cancel them first.
      if (playback.next > ctx.currentTime + 8) {
        this.clearPlayback(session, source.source);
        return;
      }
      const buffer = ctx.createBuffer(1, binary.length / 2, 24000);
      const data = buffer.getChannelData(0);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < data.length; i++) data[i] = view.getInt16(i * 2, true) / 32768;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      playback.nodes.add(node);
      node.onended = () => { playback.nodes.delete(node); node.disconnect(); };
      const start = Math.max(ctx.currentTime + 0.02, playback.next);
      try { node.start(start); } catch { playback.nodes.delete(node); return; }
      playback.next = start + buffer.duration;
      // Gate the local mic past the end of playback so speaker output can't
      // leak back into the translator (acoustic echo / re-translation loop).
      session.micGateUntil = Math.max(session.micGateUntil || 0, playback.next + 0.5);
      this.duck(session, source);
      clearTimeout(playback.timer);
      // Long hangover keeps the original ducked between chunks and gives the
      // room echo time to decay before the mic re-opens.
      playback.timer = setTimeout(() => this.restore(session, source.source), (playback.next - ctx.currentTime) * 1000 + 800);
    }

    clearPlayback(session, key) {
      const playback = session.playing.get(key);
      if (playback) {
        clearTimeout(playback.timer);
        for (const node of playback.nodes) { try { node.stop(); } catch {} node.disconnect(); }
        session.playing.delete(key);
      }
      this.restore(session, key);
    }

    stop() {
      const session = this.session;
      this.session = null;
      if (!session) return;
      clearInterval(session.timer);
      clearTimeout(session.retryTimer);
      for (const key of [...session.sources.keys()]) this.removeSource(session, key);
      for (const key of [...session.playing.keys()]) this.clearPlayback(session, key);
      session.ws?.close(1000, 'translation stopped');
      session.ctx.close().catch(() => {});
    }
  }
  window.OrbitTranslatorClient = OrbitTranslatorClient;
})();
