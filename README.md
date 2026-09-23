# Orbit Live Meeting

Orbit is a branded live-meeting application with per-listener OrbitAI voice translation and a built-in Stripe Donation Gateway.

## Included

- **Orbit branding** across the browser title, app/provider labels, welcome logo, watermarks, and injected UI.
- **OrbitAI Live Translation** in the meeting sidebar.
- Every listener can choose their own target language.
- Original transcripts and translated text appear together in the Live Translator and Participants sidebars.
- Every received audio track is captured, including shared audio mixed into a microphone track or delivered separately.
- Each listener has private translation sessions in their chosen language; local speech is shown as text without self-playback.
- Stateful Web Audio capture -> PCM16 16 kHz -> server-side Live Translation -> text + PCM16 24 kHz playback.
- Transcript history lasts for the current translation session (up to 80 entries) and clears on language/meeting changes.
- Bottom-toolbar **Donate** icon.
- Orbit-style right-side donation drawer.
- USD, PHP, and EUR donation presets plus custom amount.
- Optional donor name and email.
- Server-side Stripe Checkout Session creation.
- Stripe secret key never reaches the browser.
- Server-side Checkout Session verification on return.
- Optional signed Stripe webhook verification.

## Requirements

- Docker Engine
- Docker Compose v2
- Git
- Public DNS/domain and normal WebRTC networking/UDP configuration
- OrbitAI backend API credential
- Stripe account + Stripe secret key

## Install

```bash
./install.sh
```

Then edit:

```text
engine/.env
```

Set at minimum:

```env
PUBLIC_URL=https://meet.example.com
ORBITAI_API_KEY=YOUR_SERVER_SIDE_TRANSLATION_KEY
STRIPE_SECRET_KEY=sk_live_or_sk_test_key_here
```

Optional Stripe webhook verification:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

Start Orbit:

```bash
./start.sh
```

Stop Orbit:

```bash
./stop.sh
```

## OrbitAI user flow

1. Join an Orbit meeting.
2. Click **Translate** in the bottom toolbar, or open the Participants sidebar.
3. Choose a target language. Translation starts for your meeting audio; **Start Live Translator** defaults to English if none is selected.
4. Read **Original transcript** and **Translation** together beneath each speaker/source label. Your selection affects only your own session.
5. To translate a shared video or presentation, the presenter must enable **Share tab audio** or **Share system audio** in the browser's sharing picker. Video-only shares contain no audio to translate. Browser/OS capture support varies.
6. **Stop Translation** or **Off — original audio** releases the translation connection, restores original volume, and leaves meeting audio tracks intact.

The preference is stored locally and applied after joining, even when the sidebar is closed. If the browser blocks audio autoplay after restoring a preference, click inside the translator panel to enable playback. Use headphones when translating your own microphone alongside remote audio.

## Donation user flow

1. Click the **Donate** heart icon in the bottom toolbar.
2. The Orbit Donation Gateway opens as a right-side drawer.
3. Choose USD, PHP, or EUR.
4. Choose a preset or enter a custom amount.
5. Optionally enter name and email.
6. Click **Continue to secure donation**.
7. Orbit creates a server-side Stripe Checkout Session and redirects the donor to Stripe-hosted Checkout.
8. On return, Orbit retrieves the session server-side and confirms whether payment is paid or still processing.

## Stripe webhook

The gateway exposes this same-origin endpoint through Orbit's web container:

```text
POST https://YOUR_ORBIT_DOMAIN/api/donations/webhook
```

Configure it in Stripe and subscribe to at least:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Copy the Stripe signing secret into:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Architecture

The browser reads the current Jitsi conference's local and received audio tracks. An AudioWorklet mixes stereo to mono and resamples continuously to 16 kHz PCM, including across render-block boundaries. Audio goes to a private `/api/live/<room>` WebSocket through the web container. The server starts a Gemini Live Translate direction for each source on that listener's connection and returns both transcription streams plus 24 kHz translated audio.

Remote translated audio plays locally; original track volume is reduced only during translated playback and restored on stop, failure, or source removal. Language changes close old sessions and discard stale frames. Captions are not broadcast to other meeting users. Provider sessions are per active listener/source, so adding listeners can increase provider usage.

The original `/translate/<meeting>` JVB bridge and `/api/screen/` endpoint remain for compatibility. The Orbit sidebar disables the native receiver translation request while using its private audio path to prevent duplicate voice playback.

Orbit uses the Jitsi WebRTC meeting stack internally. The extension reads the conference's actual `getLocalTracks()` / `getParticipants()` APIs and supports both mixed and separate desktop audio.

## Security boundaries

- `ORBITAI_API_KEY` is passed only to the translator container.
- `STRIPE_SECRET_KEY` is passed only to the donation gateway container.
- Browser code receives only the Stripe Checkout URL returned for a newly-created Session.
- Donation amount/currency are validated server-side.
- Return URLs are forced to the configured `PUBLIC_URL` origin.
- Stripe return state is verified by retrieving the Checkout Session.
- Stripe webhooks are cryptographically verified when `STRIPE_WEBHOOK_SECRET` is configured.

## Validation

```bash
./validate.sh
```

This checks JavaScript syntax, integration markers, PCM conversion, continuous worklet resampling at 48 kHz and 44.1 kHz, per-listener language isolation, source cleanup and Docker Compose configuration. Run `npm ci --prefix tests` first to include DOM tests for paired sidebar text, language switching, screen/microphone capture and safe text rendering. DOM tests use simulated meeting tracks; they do not establish a real multi-party WebRTC meeting.

When changing the extension, copy `orbit-web/` and the translator source/package files into their `engine/` counterparts before running `docker compose up -d --build --no-deps web orbit-ai-translator` from `engine/`. Reload existing meeting tabs to load the new extension.
