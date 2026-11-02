'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { signInSynthetic, verifySynthetic, signOutSynthetic } = require('../scripts/test-session.js');
const email = 'osler-synthetic-reader@example.com';
test('synthetic session uses official password grant and local logout without signup', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/token?')) return Response.json({ access_token: 'synthetic.session', user: { email } });
    if (url.endsWith('/user')) return Response.json({ id: 'synthetic-id', email });
    return new Response(null, { status: 204 });
  };
  const key = 'synthetic-publishable';
  const token = await signInSynthetic({ key, email, password: 'synthetic-password', fetchImpl });
  await verifySynthetic({ key, token, fetchImpl });
  await signOutSynthetic({ key, token, fetchImpl });
  assert.equal(calls[0].url, 'https://otnwkxchugsovtjdanyu.supabase.co/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email, password: 'synthetic-password' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic.session');
  assert.ok(calls[2].url.endsWith('/logout?scope=local'));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
});
test('synthetic session blocks real identities and suppresses backend secrets', async () => {
  await assert.rejects(signInSynthetic({ key: 'synthetic', email: 'real@example.com', password: 'secret' }), /Synthetic test email/);
  for (const fetchImpl of [
    async () => new Response('private secret', { status: 400 }),
    async () => { throw new Error('private secret'); }
  ]) {
    await assert.rejects(signInSynthetic({ key: 'synthetic', email, password: 'secret', fetchImpl }),
      error => !error.message.includes('secret') && error.message.includes('suppressed'));
  }
  await assert.rejects(verifySynthetic({ key: 'synthetic', token: 'synthetic.session',
    fetchImpl: async () => Response.json({ id: 'synthetic-id', email: 'real@example.com' }) }), /Only synthetic/);
});
