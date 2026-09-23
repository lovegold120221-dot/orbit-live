import fs from 'node:fs';
const web = fs.readFileSync(new URL('../orbit-web/orbit-live-translation.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../orbit-web/orbit-translator-client.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../orbit-web/orbit-live-translation.css', import.meta.url), 'utf8');
const webDocker = fs.readFileSync(new URL('../orbit-web/Dockerfile', import.meta.url), 'utf8');
const translator = fs.readFileSync(new URL('../translator/src/server.mjs', import.meta.url), 'utf8');
const donation = fs.readFileSync(new URL('../donation-gateway/src/server.mjs', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../docker-compose.override.yml', import.meta.url), 'utf8');

for (const required of [
  'setReceiverTranslationLanguage', 'Filipino', 'Dutch', 'English', 'ORBITAI LIVE',
  'orbit-donate-toolbar-button', 'Orbit Donation Gateway', '/api/donations/create-checkout-session',
  '[Orbit Donations]', 'Start Live Translator', 'Original transcript', 'orbit-transcripts',
  '/api/screen/', 'screen-join', 'screen-pcm', 'screen-audio', 'orbit-screen-caption'
]) {
  if (!web.includes(required)) throw new Error(`Missing frontend requirement: ${required}`);
}
for (const required of ['#orbit-donation-drawer', '.orbit-toolbar-button', '.orbit-donate-submit']) {
  if (!css.includes(required)) throw new Error(`Missing CSS requirement: ${required}`);
}
for (const required of [
  'gemini-3.5-live-translate-preview', 'realtimeInput', "case 'sources'", "case 'media'",
  "event: 'start'", "event: 'stop'", 'audio/pcm;rate=16000', 'echoTargetLanguage',
  "provider: 'OrbitAI'", '[OrbitAI] websocket error', 'screen-audio', 'screen-transcript',
  'inputAudioTranscription', 'outputAudioTranscription', 'contextWindowCompression', 'ListenerSession'
]) {
  if (!translator.includes(required)) throw new Error(`Missing OrbitAI translator requirement: ${required}`);
}
for (const required of ['/api/live/', 'getParticipants', 'getLocalTracks', 'source-start', 'source-stop', 'source-status']) {
  if (!client.includes(required)) throw new Error(`Missing listener audio integration: ${required}`);
}
for (const required of [
  'stripe.checkout.sessions.create', "submit_type: 'donate'", "mode: 'payment'",
  'stripe.webhooks.constructEvent', 'payment_status', '[Orbit Donations]'
]) {
  if (!donation.includes(required)) throw new Error(`Missing Stripe gateway requirement: ${required}`);
}
for (const required of [
  'ENABLE_AUDIO_TRANSLATION', 'JICOFO_TRANSLATION_URL_TEMPLATE', 'orbit-ai-translator',
  'orbit-donation-gateway', 'STRIPE_SECRET_KEY', 'ORBITAI_API_KEY'
]) {
  if (!compose.includes(required)) throw new Error(`Missing compose requirement: ${required}`);
}
for (const required of ['interfaceConfig.APP_NAME = "Orbit"', 'location ^~ /api/donations/', 'proxy_pass http://orbit-donation-gateway:8090/', 'location ^~ /api/live/', 'proxy_pass http://orbit-ai-translator:8080/live/', 'proxy_read_timeout 3600s', 'orbit-translator-client.js', 'orbit-pcm-worklet.js']) {
  if (!webDocker.includes(required)) throw new Error(`Missing Orbit web image requirement: ${required}`);
}
console.log('Orbit static integration checks passed.');
