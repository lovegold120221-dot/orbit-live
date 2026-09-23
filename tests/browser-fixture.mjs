// Manual browser integration harness. Uses real Web Audio + the running local
// translation service with a generated 16kHz mono PCM fixture, no microphone.
// node tests/browser-fixture.mjs /tmp/generated-speech.pcm
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
const pcmPath = process.argv[2];
if (!pcmPath) throw new Error('Supply a generated PCM16, 16kHz mono speech fixture.');
const pcm = fs.readFileSync(pcmPath);
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Orbit audio verification</title>
<link rel="stylesheet" href="/orbit-live-translation.css"><style>
body{margin:0;background:#11141c;color:white;font-family:system-ui;padding:24px}main{margin-left:400px;max-width:650px}button{padding:12px;margin:6px;border-radius:8px}.participants_pane{margin-left:400px;width:360px;min-height:300px}.toolbox-content-items{position:fixed;bottom:10px;right:30px;display:flex;width:300px;height:52px}#diagnostics{white-space:pre-wrap;font-size:13px}
</style></head><body><main><h1>Orbit audio verification</h1><p>Generated speech over real browser audio tracks. No microphone or camera is used.</p>
<button id="mic">Play microphone sample</button><button id="screen">Play shared stereo sample</button><button id="remove">Remove all audio sources</button><pre id="diagnostics">Ready</pre></main>
<aside class="participants_pane" aria-label="Participants"></aside><div class="toolbox-content-items"></div>
<script>
const tracks=[];const contexts=[];
window.APP={conference:{_room:{isJoined:()=>true,getName:()=> 'browser-verification',getLocalTracks:()=>[],setReceiverTranslationLanguage:()=>{},getParticipants:()=>[{getId:()=> 'test-speaker',getDisplayName:()=> 'Test speaker',getTracks:()=>tracks}]}}};
async function sample(screen){
  const ctx=new AudioContext({sampleRate:48000});contexts.push(ctx);await ctx.resume();
  const bytes=await (await fetch('/speech.pcm')).arrayBuffer();const view=new DataView(bytes);
  const buffer=ctx.createBuffer(screen?2:1,bytes.byteLength/2,16000);
  // Stereo fixture deliberately places speech only in the right channel.
  const data=buffer.getChannelData(screen?1:0);for(let i=0;i<data.length;i++)data[i]=view.getInt16(i*2,true)/32768;
  const destination=ctx.createMediaStreamDestination();const media=destination.stream.getAudioTracks()[0];
  const track={getTrack:()=>media,isAudioTrack:()=>true,isMuted:()=>false,getVideoType:()=>screen?'desktop':undefined};tracks.push(track);
  const element=document.createElement('audio');element.srcObject=destination.stream;element.volume=0.6;element.muted=true;document.body.append(element);
  const source=ctx.createBufferSource();source.buffer=buffer;source.connect(destination);
  // Give track discovery and provider setup a moment before the first word.
  source.start(ctx.currentTime+2);
  document.getElementById('diagnostics').textContent=(screen?'Shared stereo':'Microphone')+' sample running; '+tracks.length+' audio source(s).';
}
document.getElementById('mic').onclick=()=>sample(false);
document.getElementById('screen').onclick=()=>sample(true);
document.getElementById('remove').onclick=()=>{tracks.splice(0);contexts.forEach(c=>c.close());document.getElementById('diagnostics').textContent='All fixture audio sources removed.';};
window.addEventListener('error',event=>{document.getElementById('diagnostics').textContent+='\\nERROR: '+event.message;});
window.addEventListener('unhandledrejection',event=>{document.getElementById('diagnostics').textContent+='\\nERROR: '+event.reason;});
</script><script defer src="/orbit-translator-client.js"></script><script defer src="/orbit-live-translation.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  if (pathname === '/speech.pcm') return res.end(pcm);
  const allowed = ['orbit-live-translation.js', 'orbit-live-translation.css', 'orbit-translator-client.js', 'orbit-pcm-worklet.js'];
  const name = pathname.slice(1);
  if (!allowed.includes(name)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'application/javascript');
  res.end(fs.readFileSync(new URL('../orbit-web/' + name, import.meta.url)));
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/api/live/')) return socket.destroy();
  const upstream = net.connect(8001, '127.0.0.1', () => {
    upstream.write(req.method + ' ' + req.url + ' HTTP/1.1\r\n' + Object.entries(req.headers).map(([key,value]) => key + ': ' + value).join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(8766, '127.0.0.1', () => console.log('Browser fixture: http://127.0.0.1:8766'));
