/* 補足メモ重複バグのデータ片付け。
   usage: node scripts/cleanup-shift-request-notes.mjs <envPath> [--apply]
   --apply 無しは dry-run（変更せず影響行を表示）。
   2段階:
     1) 各行の notes 内フレーズ重複を圧縮（"X / X / X" → "X"、出現順保持）
     2) (employee_id, month) 単位で notes を先頭1行に集約（残りは NULL）
        ※同一 employee×month の全フレーズの和集合を keep 行へ、他行は NULL */
import pg from 'pg'; import fs from 'node:fs';
const envPath = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!envPath) { console.error('envPath required'); process.exit(1); }
const env=Object.fromEntries(fs.readFileSync(envPath,'utf8').split(/\r?\n/).filter(Boolean).filter(l=>!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const u=(env.DATABASE_URL||env.SUPABASE_DB_URL).match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@db\.([^.]+)\.supabase\.co/);
const c=new pg.Client({host:`db.${u[3]}.supabase.co`,port:5432,user:'postgres',password:decodeURIComponent(u[2]),database:'postgres',ssl:{rejectUnauthorized:false}});
await c.connect();
console.log(`\n### DB=${u[3]} mode=${APPLY?'APPLY':'DRY-RUN'} ###`);
try {
  // 影響行 (フレーズ重複 or 同一 employee×month 複数行に notes)
  const before=await c.query(`
    SELECT count(*) FILTER (WHERE array_length(string_to_array(notes,' / '),1) >
                                  (SELECT count(DISTINCT trim(t)) FROM unnest(string_to_array(notes,' / ')) t)) AS phrase_dup_rows,
           count(*) FILTER (WHERE notes IS NOT NULL AND notes<>'') AS rows_with_notes
      FROM public.shift_requests WHERE notes IS NOT NULL AND notes<>''`);
  console.log('片付け前: フレーズ重複行=', before.rows[0].phrase_dup_rows, ' / notes保有行=', before.rows[0].rows_with_notes);

  const emMulti=await c.query(`
    SELECT count(*) AS n FROM (
      SELECT employee_id, month FROM public.shift_requests
       WHERE notes IS NOT NULL AND notes<>'' GROUP BY employee_id, month HAVING count(*)>1) q`);
  console.log('notes が複数行に分散している (employee,month) 組数=', emMulti.rows[0].n);

  if (!APPLY) {
    // サンプル表示
    const sample=await c.query(`
      SELECT employee_id, month, request_type,
             array_length(string_to_array(notes,' / '),1) AS phrases,
             (SELECT count(DISTINCT trim(t)) FROM unnest(string_to_array(notes,' / ')) t) AS distinct_phrases,
             left(notes,60) AS head
        FROM public.shift_requests WHERE notes IS NOT NULL AND notes<>''
       ORDER BY length(notes) DESC LIMIT 10`);
    console.log('\n上位サンプル:');
    for(const r of sample.rows) console.log(`  ${r.month} ${String(r.request_type).padEnd(16)} phrases=${r.phrases} distinct=${r.distinct_phrases} "${r.head}..."`);
    console.log('\n(dry-run: 変更なし。--apply で適用)');
    await c.end(); process.exit(0);
  }

  await c.query('BEGIN');
  // 1) 行内フレーズ重複圧縮（出現順保持）
  const s1=await c.query(`
    WITH exploded AS (
      SELECT id, trim(phrase) AS phrase, min(ord) AS first_ord
        FROM public.shift_requests, unnest(string_to_array(notes,' / ')) WITH ORDINALITY AS u(phrase, ord)
       WHERE notes IS NOT NULL AND notes<>'' AND trim(phrase)<>''
       GROUP BY id, trim(phrase)
    ), deduped AS (
      SELECT id, string_agg(phrase, ' / ' ORDER BY first_ord) AS new_notes FROM exploded GROUP BY id
    )
    UPDATE public.shift_requests sr SET notes=d.new_notes
      FROM deduped d WHERE sr.id=d.id AND sr.notes IS DISTINCT FROM d.new_notes`);
  console.log('① 行内重複圧縮: 更新', s1.rowCount, '行');

  // 2) (employee,month) 単位で notes を先頭行に集約。
  //    keep 行に全行の distinct フレーズ和集合を入れ、他行は NULL。
  const s2keep=await c.query(`
    WITH merged AS (
      SELECT employee_id, month,
             (array_agg(id ORDER BY id))[1] AS keep_id,
             string_agg(DISTINCT trim(phrase), ' / ') AS merged_notes
        FROM public.shift_requests sr, unnest(string_to_array(sr.notes,' / ')) AS u(phrase)
       WHERE sr.notes IS NOT NULL AND sr.notes<>'' AND trim(phrase)<>''
       GROUP BY employee_id, month
    )
    UPDATE public.shift_requests sr SET notes=m.merged_notes
      FROM merged m WHERE sr.id=m.keep_id AND sr.notes IS DISTINCT FROM m.merged_notes`);
  console.log('② keep行へ集約: 更新', s2keep.rowCount, '行');
  const s2null=await c.query(`
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY employee_id, month ORDER BY id) AS rn
        FROM public.shift_requests WHERE notes IS NOT NULL AND notes<>''
    )
    UPDATE public.shift_requests sr SET notes=NULL
      FROM ranked r WHERE sr.id=r.id AND r.rn>1`);
  console.log('② 他行を NULL: 更新', s2null.rowCount, '行');

  await c.query('COMMIT');

  const after=await c.query(`
    SELECT count(*) FILTER (WHERE array_length(string_to_array(notes,' / '),1) >
                                  (SELECT count(DISTINCT trim(t)) FROM unnest(string_to_array(notes,' / ')) t)) AS phrase_dup_rows,
           count(*) FILTER (WHERE notes IS NOT NULL AND notes<>'') AS rows_with_notes
      FROM public.shift_requests WHERE notes IS NOT NULL AND notes<>''`);
  console.log('片付け後: フレーズ重複行=', after.rows[0].phrase_dup_rows, ' / notes保有行=', after.rows[0].rows_with_notes);
  console.log(after.rows[0].phrase_dup_rows==='0' ? '✅ フレーズ重複ゼロ' : '!! まだ重複あり');
} catch(e){ await c.query('ROLLBACK').catch(()=>{}); console.error('ROLLBACK:', e.message); }
finally { await c.end(); }
