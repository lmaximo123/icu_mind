'use strict';
const { createServer } = require('./app.js');
const { createStore } = require('./supabase.js');
const store = createStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY });
const enableRemoteUI = process.env.OSLER_ENABLE_REMOTE_UI === '1';
if (enableRemoteUI && (process.env.SUPABASE_URL !== 'https://otnwkxchugsovtjdanyu.supabase.co' ||
    !process.env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'))) throw new Error('Remote UI requires the authorized development project and publishable key');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
createServer(store, { staticRoot: require('node:path').resolve(__dirname, '..'), enableRemoteUI })
  .listen(port, '127.0.0.1', () => console.log(`Osler development server listening on port ${port}`));
