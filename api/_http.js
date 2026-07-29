/* Blueprint Buddy — shared HTTP plumbing for the zero-dependency api/.
 *
 * One implementation of the helpers every endpoint used to hand-roll:
 * body reading (platform-parsed or streamed under a size cap), JSON
 * replies, and the deploy origin. api/clientlog.js keeps its own reader
 * on purpose — it drains an oversized body and answers 204 instead of
 * destroying the socket under a crashing page.
 *
 * Files starting with "_" are libraries, not deployed Vercel functions. */
'use strict';

const S = require('./_session.js');

/* Vercel parses JSON bodies into req.body; plain Node (serve.js) does not.
 * Accept both, with a hard size cap on the raw stream.
 *   opts.maxBytes    stream cap in bytes (default 16 KiB)
 *   opts.emptyOk     treat an empty body as {} (form-style endpoints)
 *   opts.tooLargeMsg error message for the cap (store says 'value too large') */
function readBody(req, opts) {
  opts = opts || {};
  const max = opts.maxBytes || 16384;
  if (req.body !== undefined) {
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new Error(opts.tooLargeMsg || 'body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(opts.emptyOk ? (text || '{}') : text));
      } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, obj, cookies) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(obj));
}

/* The deploy origin OAuth and Stripe redirects target: APP_ORIGIN when the
 * operator pinned it, else derived from the (proxy-forwarded) Host. */
function origin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return (S.isSecure(req) ? 'https' : 'http') + '://' + host;
}

module.exports = { readBody, sendJSON, origin };
