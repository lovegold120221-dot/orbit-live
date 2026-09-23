/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Keep fractional sample state across render quanta (usually 128 frames).
// Resetting a 3:1 resampler every quantum loses two samples per block.
class OrbitPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0;
    this.sum = 0;
    this.frame = new Int16Array(1600);
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i] / channels.length;
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += mono * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.frame[this.offset++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.sum = 0;
          this.weight = 0;
          if (this.offset === this.frame.length) {
            // Explicit little endian, independently of the browser architecture.
            const bytes = new Uint8Array(this.frame.length * 2);
            const view = new DataView(bytes.buffer);
            this.frame.forEach((value, index) => view.setInt16(index * 2, value, true));
            this.port.postMessage(bytes, [bytes.buffer]);
            this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('orbit-pcm16', OrbitPcmProcessor);
