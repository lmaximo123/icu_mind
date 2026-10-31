'use strict';
// Official Auth password grant; credentials and session material stay in memory.
const developmentUrl = 'https://otnwkxchugsovtjdanyu.supabase.co';
const syntheticEmail = /^osler-synthetic-[a-z0-9-]+@example\.com$/;
async function authRequest(key, path, options = {}, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(developmentUrl + '/auth/v1/' + path, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: key, 'Content-Type': 'application/json', ...options.headers }
    });
    if (!response.ok) throw new Error();
    return response;
  } catch { throw new Error('Synthetic Auth request failed; response details suppressed'); }
}
async function signInSynthetic({ key, email, password, fetchImpl }) {
  if (!key || !syntheticEmail.test(email || '') || !password) {
    throw new Error('Synthetic test email, password and publishable key required');
  }
  const response = await authRequest(key, 'token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email, password })
  }, fetchImpl);
  let session;
  try { session = await response.json(); }
  catch { throw new Error('Invalid synthetic Auth response'); }
  if (typeof session.access_token !== 'string' || !session.access_token || session.user?.email !== email) {
    throw new Error('Invalid synthetic Auth session');
  }
  return session.access_token;
}
async function verifySynthetic({ key, token, fetchImpl }) {
  const response = await authRequest(key, 'user', {
    headers: { Authorization: `Bearer ${token}` }
  }, fetchImpl);
  let user;
  try { user = await response.json(); }
  catch { throw new Error('Invalid synthetic Auth user'); }
  if (!user.id || !syntheticEmail.test(user.email || '')) throw new Error('Only synthetic test users are allowed');
  return { id: user.id, email: user.email };
}
async function signOutSynthetic({ key, token, fetchImpl }) {
  await authRequest(key, 'logout?scope=local', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  }, fetchImpl);
}
module.exports = { signInSynthetic, verifySynthetic, signOutSynthetic };
