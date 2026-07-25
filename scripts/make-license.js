#!/usr/bin/env node
/**
 * make-license.js — keypair generator + licence minter for AuthNo Pro.
 *
 * The app verifies licence keys offline with an embedded PUBLIC key
 * (REACT_APP_LICENSE_PUBKEY). This script holds the other half: it creates the
 * keypair once, then signs a licence key per buyer. The PRIVATE key must never
 * be committed or shipped — anyone holding it can mint free Pro licences.
 *
 *   Generate a keypair (do this once):
 *     node scripts/make-license.js keygen
 *       → prints REACT_APP_LICENSE_PUBKEY (put in .env / CI secrets)
 *       → writes authno-license-private.json (KEEP SECRET, never commit)
 *
 *   Mint a licence for a buyer:
 *     node scripts/make-license.js sign --order ORDER-1234 --email a@b.com
 *       → prints AUTHNO-… ; paste that into the buyer's receipt email
 *
 * Optional: --expires 2027-01-01 for a time-limited key (omit for perpetual).
 */

const { webcrypto } = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIV_FILE = path.join(process.cwd(), 'authno-license-private.json');
const b64 = (buf) => Buffer.from(buf).toString('base64');
const b64url = (buf) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function keygen() {
  if (fs.existsSync(PRIV_FILE)) {
    console.error(`Refusing to overwrite ${PRIV_FILE} — existing licences verify against it.`);
    process.exit(1);
  }
  const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = await webcrypto.subtle.exportKey('spki', kp.publicKey);
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', kp.privateKey);
  fs.writeFileSync(PRIV_FILE, JSON.stringify({ privateKey: b64(pkcs8) }, null, 2), { mode: 0o600 });
  console.log('\nPrivate key written to', PRIV_FILE, '— KEEP SECRET, never commit.\n');
  console.log('Add this to your .env / CI secrets:\n');
  console.log(`REACT_APP_LICENSE_PUBKEY=${b64(spki)}\n`);
}

async function sign() {
  if (!fs.existsSync(PRIV_FILE)) {
    console.error(`No ${PRIV_FILE}. Run: node scripts/make-license.js keygen`);
    process.exit(1);
  }
  const { privateKey } = JSON.parse(fs.readFileSync(PRIV_FILE, 'utf8'));
  const key = await webcrypto.subtle.importKey(
    'pkcs8', Buffer.from(privateKey, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );

  const payload = { p: 'pro', o: arg('order', `ORDER-${Date.now()}`), t: Date.now() };
  const email = arg('email');
  if (email) payload.e = email;
  const expires = arg('expires');
  if (expires) {
    const exp = Date.parse(expires);
    if (Number.isNaN(exp)) { console.error(`Bad --expires date: ${expires}`); process.exit(1); }
    payload.exp = exp;
  }

  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes);
  console.log(`\nAUTHNO-${b64url(bytes)}.${b64url(sig)}\n`);
  console.log('payload:', JSON.stringify(payload), '\n');
}

const cmd = process.argv[2];
if (cmd === 'keygen') keygen();
else if (cmd === 'sign') sign();
else {
  console.log('Usage:\n  node scripts/make-license.js keygen\n  node scripts/make-license.js sign --order ORDER-1234 [--email a@b.com] [--expires 2027-01-01]');
  process.exit(1);
}
