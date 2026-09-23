import http from 'node:http';
import process from 'node:process';
import Stripe from 'stripe';

const PORT = Number(process.env.PORT || 8090);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const PUBLIC_URL = String(process.env.PUBLIC_URL || 'https://localhost:8443').replace(/\/$/, '');
const DEFAULT_CURRENCY = String(process.env.DONATION_DEFAULT_CURRENCY || 'usd').toLowerCase();
const ALLOWED_CURRENCIES = new Set(
  String(process.env.DONATION_ALLOWED_CURRENCIES || 'usd,php,eur')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);
const MIN_MINOR = Number(process.env.DONATION_MIN_MINOR || 100);
const MAX_MINOR = Number(process.env.DONATION_MAX_MINOR || 100000000);

if (!STRIPE_SECRET_KEY) {
  console.error('[Orbit Donations] STRIPE_SECRET_KEY is required');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  maxNetworkRetries: 2,
  timeout: 30000
});

function log(level, message, extra) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${new Date().toISOString()}] [Orbit Donations] ${message}`, extra || '');
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sanitizeText(value, max = 120) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function safeReturnUrl(returnPath, state) {
  const base = new URL(PUBLIC_URL);
  let candidate;
  try {
    candidate = new URL(typeof returnPath === 'string' ? returnPath : '/', base);
  } catch {
    candidate = new URL('/', base);
  }
  if (candidate.origin !== base.origin) candidate = new URL('/', base);
  candidate.searchParams.set('orbitDonation', state);
  if (state === 'success') candidate.searchParams.set('session_id', '{CHECKOUT_SESSION_ID}');
  return candidate.toString();
}

function parseMinorAmount(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_MINOR || n > MAX_MINOR) return null;
  return n;
}

async function createCheckout(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (error) {
    return json(res, 400, { error: 'Invalid request body.' });
  }

  const amount = parseMinorAmount(payload.amountMinor);
  const currency = sanitizeText(payload.currency || DEFAULT_CURRENCY, 3).toLowerCase();
  const donorName = sanitizeText(payload.name, 100);
  const donorEmail = sanitizeText(payload.email, 320);
  const room = sanitizeText(payload.room, 160);

  if (!amount) return json(res, 400, { error: 'Invalid donation amount.' });
  if (!ALLOWED_CURRENCIES.has(currency)) return json(res, 400, { error: 'Unsupported currency.' });
  if (donorEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) {
    return json(res, 400, { error: 'Invalid email address.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      submit_type: 'donate',
      customer_email: donorEmail || undefined,
      billing_address_collection: 'auto',
      line_items: [{
        price_data: {
          currency,
          unit_amount: amount,
          product_data: {
            name: 'Orbit Donation',
            description: 'Support Orbit live communication services'
          }
        },
        quantity: 1
      }],
      success_url: safeReturnUrl(payload.returnPath, 'success'),
      cancel_url: safeReturnUrl(payload.returnPath, 'cancelled'),
      client_reference_id: room || undefined,
      metadata: {
        type: 'orbit_donation',
        donor_name: donorName || 'Anonymous',
        room: room || ''
      }
    });

    log('info', `Checkout session created ${session.id}`);
    return json(res, 200, { id: session.id, url: session.url });
  } catch (error) {
    log('error', 'Stripe Checkout session creation failed', error?.message || error);
    return json(res, 502, { error: 'Donation checkout is temporarily unavailable.' });
  }
}

async function getSession(req, res, url) {
  const id = sanitizeText(url.searchParams.get('session_id') || '', 200);
  if (!/^cs_/.test(id)) return json(res, 400, { error: 'Invalid session ID.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(id);
    return json(res, 200, {
      id: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      customerEmail: session.customer_details?.email || null
    });
  } catch (error) {
    log('warn', `Unable to retrieve Checkout session ${id}`, error?.message || error);
    return json(res, 404, { error: 'Donation session not found.' });
  }
}

async function webhook(req, res) {
  const raw = await readBody(req, 1024 * 1024);
  if (!STRIPE_WEBHOOK_SECRET) {
    log('warn', 'Webhook received but STRIPE_WEBHOOK_SECRET is not configured');
    return json(res, 503, { error: 'Webhook verification is not configured.' });
  }
  const signature = req.headers['stripe-signature'];
  try {
    const event = stripe.webhooks.constructEvent(raw, signature, STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      log('info', `Donation completed ${session.id} ${session.amount_total || 0} ${session.currency || ''}`);
    } else if (event.type === 'checkout.session.async_payment_failed') {
      log('warn', `Donation payment failed ${event.data.object.id}`);
    } else {
      log('info', `Unhandled event type: ${event.type}`);
    }
    return json(res, 200, { received: true });
  } catch (error) {
    log('warn', 'Stripe webhook verification failed', error?.message || error);
    return json(res, 400, { error: 'Invalid webhook signature.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'orbit-donation-gateway' });
    }
    if (req.method === 'POST' && url.pathname === '/create-checkout-session') {
      return await createCheckout(req, res);
    }
    if (req.method === 'GET' && url.pathname === '/session') {
      return await getSession(req, res, url);
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      return await webhook(req, res);
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    log('error', 'Unhandled gateway error', error?.stack || error);
    return json(res, 500, { error: 'Internal donation gateway error.' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log('info', `Gateway listening on :${PORT}`);
});

function shutdown() {
  log('info', 'Shutting down gateway');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
