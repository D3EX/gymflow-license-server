require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Render sits behind a proxy; this tells express-rate-limit to trust the
// X-Forwarded-For header it sets, instead of logging a warning every request.
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// ---- Load the private signing key ----
// Either point PRIVATE_KEY_PATH at a PEM file on disk (kept OUTSIDE the repo),
// or set PRIVATE_KEY_PEM directly as an env var (useful on hosts with no file
// uploads — paste the PEM contents with real newlines replaced by \n).
const PRIVATE_KEY_PEM = process.env.PRIVATE_KEY_PEM
  ? process.env.PRIVATE_KEY_PEM.replace(/\\n/g, '\n')
  : fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');

// ---- Tiny JSON "database" of issued licenses ----
// Lets the server be idempotent (same fingerprint always gets the same code
// back instead of minting a fresh one every time), and gives you an audit
// trail of who was issued what, in case you ever need to look something up.
const DB_PATH = path.join(__dirname, 'data', 'licenses.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '{}');

function loadDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

const FINGERPRINT_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signFingerprint(fingerprint) {
  const signer = crypto.createSign('SHA256');
  signer.update(fingerprint, 'utf8');
  signer.end();
  // Node's default DER encoding matches Java/Android's SHA256withECDSA output,
  // so this verifies correctly against DeviceLicense.kt with no changes there.
  return signer.sign(PRIVATE_KEY_PEM).toString('base64');
}

// ---- Outgoing email via Brevo's HTTP API ----
// Render's free tier blocks outbound traffic on SMTP ports (25/465/587), so
// we send mail over regular HTTPS instead, via Brevo's REST API. You still
// send "from" your own verified email address — see BREVO_SENDER_EMAIL.
async function sendLicenseEmail(toEmail, fingerprint, licenseCode) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: process.env.BREVO_SENDER_NAME || 'GymFlow Admin',
      },
      to: [{ email: toEmail }],
      bcc: process.env.ADMIN_EMAIL ? [{ email: process.env.ADMIN_EMAIL }] : undefined,
      subject: 'Your GymFlow Admin license code',
      textContent:
        `Thanks for activating GymFlow Admin!\n\n` +
        `Device: ${fingerprint}\n` +
        `License code:\n${licenseCode}\n\n` +
        `Keep this email — you may need the code again if you ever reinstall the app.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo send failed: ${res.status} ${body}`);
  }
}

// Basic abuse protection. There's no purchase gate on this endpoint (by
// design, per your setup), so this just caps how often any one IP can hit
// it — it doesn't restrict who's allowed a license.
const activateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

app.post('/activate', activateLimiter, async (req, res) => {
  try {
    const { fingerprint, email } = req.body || {};

    if (typeof fingerprint !== 'string' || !FINGERPRINT_RE.test(fingerprint)) {
      return res.status(400).json({ success: false, error: 'Invalid fingerprint format.' });
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email address.' });
    }

    const db = loadDb();
    let licenseCode;

    if (db[fingerprint]) {
      // Already issued for this device — resend the same code rather than
      // minting (and logging) a new one every time someone retries.
      licenseCode = db[fingerprint].code;
    } else {
      licenseCode = signFingerprint(fingerprint);
      db[fingerprint] = { code: licenseCode, email, issuedAt: new Date().toISOString() };
      saveDb(db);
    }

    // Don't block the HTTP response on email delivery — the app already has
    // the code and can activate instantly either way.
    sendLicenseEmail(email, fingerprint, licenseCode).catch((err) => {
      console.error('Email send failed:', err);
    });

    return res.json({ success: true, licenseCode });
  } catch (err) {
    console.error('Activation error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`License server listening on port ${PORT}`));
