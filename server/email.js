// ─── server/email.js ──────────────────────────────────────────────────────────
// Thin wrapper around the Resend HTTP API (no SDK dependency). Sending is gated
// on RESEND_API_KEY — without it, emails are logged instead of sent so the app
// stays fully functional in local/dev.

const https = require('https');

const FROM = process.env.RETURNS_FROM_EMAIL
  || 'Premium Fulfilment Hub <hub@hub.premiumfulfilment.co.uk>';

function resendRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      method: 'POST',
      hostname: 'api.resend.com',
      path: '/emails',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// sendEmail({ to, subject, html, replyTo }). `to` is a string or array.
async function sendEmail({ to, subject, html, text, replyTo }) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) { console.warn('[email] no recipients — skipped'); return { ok: false }; }

  if (!process.env.RESEND_API_KEY) {
    console.log(`[email] (RESEND_API_KEY not set) would send "${subject}" to ${recipients.join(', ')}`);
    return { ok: false, skipped: true };
  }

  const payload = { from: FROM, to: recipients, subject };
  if (html) payload.html = html;
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;

  const res = await resendRequest(payload);
  if (res.status >= 200 && res.status < 300) {
    console.log(`[email] sent "${subject}" to ${recipients.join(', ')} (id ${res.body?.id || '—'})`);
    return { ok: true, id: res.body?.id };
  }
  console.error(`[email] send failed (${res.status}):`, JSON.stringify(res.body));
  return { ok: false, status: res.status, error: res.body };
}

module.exports = { sendEmail };
