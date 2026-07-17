/* migration 205 (category audience) を pooler 経由で適用 */
import { createPgClient } from './_db.mjs';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.resolve(projectRoot, '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean).filter(l => !l.startsWith('#')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const migrationSql = fs.readFileSync(path.resolve(projectRoot, 'supabase', 'migrations', '205_category_audience.sql'), 'utf8');

const client = createPgClient(env);

await client.connect();
try {
  console.log('--- applying migration 205 ---');
  await client.query(migrationSql);
  console.log('--- applied ---\n');

  const after = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='categories'
      AND column_name IN ('target_type','target_facility_ids','created_by')
    ORDER BY column_name
  `);
  console.log('カラム:', after.rows.map(r => r.column_name).join(', '));

  const pol = await client.query(`
    SELECT polname FROM pg_policy WHERE polrelid = 'public.categories'::regclass ORDER BY polname
  `);
  console.log('RLS:', pol.rows.map(r => r.polname).join(', '));

  const dist = await client.query(`SELECT target_type, count(*)::int as cnt FROM public.categories GROUP BY target_type`);
  console.log('既存カテゴリ分布:');
  for (const r of dist.rows) console.log(`  ${r.target_type}: ${r.cnt} 件`);
} finally {
  await client.end();
}
