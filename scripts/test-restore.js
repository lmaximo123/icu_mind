'use strict';
// Isolated PostgreSQL WASM test; never connects to hosted data or exports credentials.
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
async function main() {
  const start = performance.now();
  const db = new PGlite({ extensions: { pgcrypto } });
  let restored;
  try {
    const clean = sql => sql.split('\n').filter(line => !line.startsWith('\\')).join('\n');
    await db.exec(clean(await fs.readFile('supabase/tests/bootstrap.sql','utf8')));
    for (const file of (await fs.readdir('supabase/migrations')).filter(file => file.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file,'utf8'));
    await db.exec(clean(await fs.readFile('supabase/tests/security.sql','utf8')));
    await db.exec(clean(await fs.readFile('supabase/tests/advanced-security.sql','utf8')));
    await db.exec(clean(await fs.readFile('supabase/tests/engine-snapshot.sql','utf8')));
    await db.exec(clean(await fs.readFile('supabase/tests/durability.sql','utf8')));
    await db.exec('reset role');
    const committed = performance.now();
    const snapshot = await db.dumpDataDir('none');
    const dumpComplete = performance.now();
    restored = new PGlite({ loadDataDir: snapshot, extensions: { pgcrypto } });
    await restored.waitReady;
    const check = await restored.query("select id,concept,numeric_value from public.observation_events where id='40000000-0000-0000-0000-000000000001'");
    assert.equal(check.rows.length, 1); assert.equal(Number(check.rows[0].numeric_value), 7.4);
    await restored.exec("set role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false)");
    assert.equal((await restored.query('select count(*)::int as n from public.observation_events')).rows[0].n, 1);
    await assert.rejects(restored.exec('delete from public.observation_events'));
    await restored.exec('reset role');
    const end = performance.now();
    const report={ result:'passed', source:'isolated synthetic PostgreSQL WASM only',
      setup_ms:Math.round(committed-start), snapshot_ms:Math.round(dumpComplete-committed),
      restore_and_verify_ms:Math.round(end-dumpComplete), observed_committed_rows_lost:0,
      hosted_backup_restore:'not tested', encrypted_external_copy:'not tested' };
    await fs.mkdir('.test-artifacts',{recursive:true});
    await fs.writeFile('.test-artifacts/restore-report.json',JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally { await restored?.close(); await db.close(); }
}
main().catch(error => { console.error('Isolated restore test failed: ' + error.message); process.exitCode=1; });
