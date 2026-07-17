/* migration 217: get_my_facility_shift_view_employees RPC を pooler 経由で適用 + 検証
   - 関数の存在確認
   - employee ロール視点で実 JWT を注入して、🎨パレットの社員一覧が複数件返るか確認
     (これまでは employees の RLS で自分のみだったため 1 件しか返らなかった) */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(__dirname,'..','.env.local'),'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()];})
);
const migrationSql = fs.readFileSync(path.resolve(__dirname,'..','supabase','migrations','217_facility_shift_view_employees_rpc.sql'),'utf8');
const client = createPgClient(env);
const PALETTE = 'cc92a6de-0b33-4bbd-a805-1e8d95865272';

await client.connect();
try {
  console.log('--- applying migration 217 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  // 関数の存在確認
  const fn = await client.query(`select proname from pg_proc where proname='get_my_facility_shift_view_employees'`);
  console.log('RPC 関数:', fn.rows.length ? 'OK (作成済)' : '!! 無し');

  // 実 employee で確認 (🎨パレットに居る active employee を 1 人選んで JWT 注入)
  const emp = await client.query(
    `select id, auth_user_id, last_name, first_name from employees
     where facility_id=$1 and role='employee' and status='active' and auth_user_id is not null
     limit 1`,
    [PALETTE],
  );
  if (emp.rows.length === 0) {
    console.log('!! テスト用 employee が見つからない (パレットに active employee 居ない?)');
    process.exit(0);
  }
  const me = emp.rows[0];
  console.log(`テスト employee: ${me.last_name} ${me.first_name} (${me.id})`);

  // 修正前後の比較
  // 1) 直接 employees クエリ (RLS あり) → 自分しか返らないはず
  await client.query('BEGIN');
  await client.query('set local role authenticated');
  await client.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: me.auth_user_id, role: 'authenticated' })],
  );
  const direct = await client.query(
    `select id, last_name, first_name from employees
     where facility_id=$1 and status='active'`,
    [PALETTE],
  );
  console.log(`修正前パス (employees RLS 経由): ${direct.rows.length} 件`);

  // 2) 新 RPC → パレットの active employee 全員返るはず
  const rpc = await client.query(
    `select id, last_name, first_name from public.get_my_facility_shift_view_employees($1)`,
    [[PALETTE]],
  );
  console.log(`修正後パス (新 RPC 経由): ${rpc.rows.length} 件`);
  for (const r of rpc.rows) {
    console.log(`  ${r.last_name} ${r.first_name} (${r.id})`);
  }
  await client.query('ROLLBACK');

  // 3) 全社員数 (RLS バイパス = 真値) と RPC の差を確認
  const truthAll = await client.query(
    `select count(*)::int n from employees
     where facility_id=$1 and status='active'`,
    [PALETTE],
  );
  console.log(`真値 (パレット active 全員): ${truthAll.rows[0].n} 件`);
  console.log(rpc.rows.length === truthAll.rows[0].n ? '✅ RPC は壁掲示相当の全社員を返している' : '!! RPC の件数が真値と違う');
} finally {
  await client.end();
}
