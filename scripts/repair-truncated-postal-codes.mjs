/* 末尾1桁が欠けた郵便番号を、保存済みの住所と突き合わせて復旧する。
 *
 * 背景（docs/error-log.md 参照）:
 *   住所自動補完のコールバックが「古い data」を書き戻していたため、
 *   7桁入力 → 住所は入るが郵便番号だけ末尾1桁が巻き戻る、という壊れ方をしていた。
 *   壊れた行には必ず住所が入っている（住所補完が成功したときだけ起きるため）ので、
 *   6桁 + 0〜9 の 10 通りを郵便番号 API に問い合わせ、住所が一致する候補を特定できる。
 *
 * 安全策:
 *   - 既定は dry-run。--apply で書き込み
 *   - **候補がちょうど 1 つに絞れた行だけ**を更新する。0 個 / 2 個以上は手入力用に一覧出力
 *   - 住所の突合は「API が返す 都道府県+市区町村+町域 が、保存住所の先頭に一致するか」。
 *     番地・建物名は保存住所側にだけ付くのが前提
 *   - 7桁ある行には一切触れない（書式の統一もしない）
 *   - 外部へ送るのは**郵便番号の候補だけ**。氏名・住所は送らない
 *
 * 使い方:
 *   node scripts/repair-truncated-postal-codes.mjs           # dry-run
 *   node scripts/repair-truncated-postal-codes.mjs --apply   # 実行
 */
import { createPgClient } from './_db.mjs';

const APPLY = process.argv.includes('--apply');

/** 対象カラムと、対になる住所カラム */
const PAIRS = [
  { zip: 'postal_code', addr: 'address', label: '本人' },
  { zip: 'emergency1_postal_code', addr: 'emergency1_address', label: '緊急連絡先1' },
  { zip: 'emergency2_postal_code', addr: 'emergency2_address', label: '緊急連絡先2' },
  { zip: 'guarantor_postal_code', addr: 'guarantor_address', label: '保証人' },
];

const digitsOf = (s) => (s ?? '').replace(/\D/g, '');
/** 突合用の正規化: 空白（半角/全角）とハイフン類を除去 */
const norm = (s) => (s ?? '').replace(/[\s　]/g, '').replace(/[-‐-―ー−]/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** zipcloud に問い合わせ、住所候補を都道府県 / 市区町村 / 町域 に分けて返す */
async function lookupZip(zip7) {
  const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip7}`);
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== 200 || !json.results) return [];
  return json.results.map((r) => ({ pref: r.address1, city: r.address2, town: r.address3 }));
}

/**
 * 保存住所と候補住所の一致判定。
 * - 保存住所は都道府県を省いて入力されていることがある（例「名古屋市千種区北千種3丁目…」）ため、
 *   都道府県あり／なしの両方で前方一致を見る
 * - 町域 (town) が空の候補は「以下に掲載がない場合」を表す包括コード。
 *   市区町村までしか一致しないので**ほぼ何にでも当たってしまう**。
 *   これを通常の候補と同列に扱うと候補が絞れなくなるため weak として区別する
 */
function matchKind(storedNorm, cand) {
  const withPref = norm(`${cand.pref}${cand.city}${cand.town}`);
  const withoutPref = norm(`${cand.city}${cand.town}`);
  const hit = storedNorm.startsWith(withPref) || storedNorm.startsWith(withoutPref);
  if (!hit) return null;
  return cand.town && cand.town.trim() !== '' ? 'strong' : 'weak';
}

const client = createPgClient();
await client.connect();
try {
  console.log(APPLY ? '=== APPLY モード（DB を更新します）===\n' : '=== DRY-RUN（--apply で実行）===\n');

  const fixable = [];
  const manual = [];
  let scanned = 0;

  for (const { zip, addr, label } of PAIRS) {
    const { rows } = await client.query(`
      select id, last_name, first_name, ${zip} z, ${addr} a
        from public.employees
       where ${zip} is not null and ${zip} <> ''
         and length(regexp_replace(${zip}, '[^0-9]', '', 'g')) = 6
       order by last_name`);
    if (rows.length === 0) continue;
    console.log(`--- ${label} (${zip}): ${rows.length} 件 ---`);

    for (const r of rows) {
      scanned++;
      const six = digitsOf(r.z);
      const storedAddr = norm(r.a);
      const who = `${r.last_name} ${r.first_name}`;

      if (!storedAddr) {
        manual.push({ label, who, z: r.z, reason: '住所が空で照合できない' });
        console.log(`  △ ${who}: "${r.z}" → 住所が空のため判定不可`);
        continue;
      }

      const strong = [];
      const weak = [];
      for (let d = 0; d <= 9; d++) {
        const cand = `${six}${d}`;
        let cands = [];
        try {
          cands = await lookupZip(cand);
        } catch (e) {
          console.log(`  !! API エラー (${cand}): ${e.message}`);
        }
        await sleep(120); // 公開 API への配慮
        for (const cc of cands) {
          const kind = matchKind(storedAddr, cc);
          if (kind === 'strong') {
            strong.push({ cand, addr: `${cc.pref}${cc.city}${cc.town}`, townLen: norm(cc.town).length });
          } else if (kind === 'weak') {
            weak.push({ cand, addr: `${cc.pref}${cc.city}（町域指定なし）`, townLen: 0 });
          }
        }
      }
      /* 町域まで一致した候補を優先。それが 1 つに絞れないときだけ包括コードを見る */
      const uniq = (arr) => [...new Map(arr.map((h) => [h.cand, h])).values()];
      /* 町域が別の町域の前方一致になっているケース（例「矢田」と「矢田南」）は、
         **より長く一致した方が正しい**。最長一致だけを残す。 */
      const keepLongest = (arr) => {
        if (arr.length <= 1) return arr;
        const max = Math.max(...arr.map((h) => h.townLen));
        return arr.filter((h) => h.townLen === max);
      };
      const s = keepLongest(uniq(strong));
      const w = uniq(weak);
      const hits = s.length > 0 ? s : w;
      const via = s.length > 0 ? '' : '（町域指定なしコード）';

      if (hits.length === 1) {
        const formatted = `${hits[0].cand.slice(0, 3)}-${hits[0].cand.slice(3)}`;
        fixable.push({ id: r.id, zip, who, label, from: r.z, to: formatted, matched: hits[0].addr });
        console.log(`  ✅ ${who}: "${r.z}" → "${formatted}"  （${hits[0].addr}）${via}`);
      } else if (hits.length === 0) {
        manual.push({ label, who, z: r.z, reason: '住所に一致する候補なし' });
        console.log(`  ✗ ${who}: "${r.z}" → 候補なし（住所: ${String(r.a).slice(0, 24)}…）`);
      } else {
        manual.push({ label, who, z: r.z, reason: `候補が ${hits.length} 個（${hits.map((h) => h.cand).join(', ')}）` });
        console.log(`  ✗ ${who}: "${r.z}" → 候補 ${hits.length} 個に絞れず（${hits.map((h) => h.cand).join(', ')}）`);
      }
    }
    console.log('');
  }

  console.log(`=== 判定: 対象 ${scanned} 件 / 自動修復可 ${fixable.length} 件 / 要手入力 ${manual.length} 件 ===`);

  if (manual.length > 0) {
    console.log('\n--- 手入力が必要 ---');
    for (const m of manual) console.log(`  ${m.label} / ${m.who}: "${m.z}" … ${m.reason}`);
  }

  if (fixable.length === 0) {
    console.log('\n更新対象はありません。');
  } else if (!APPLY) {
    console.log('\n（DRY-RUN のため何も更新していません。--apply で実行してください）');
  } else {
    await client.query('BEGIN');
    try {
      let n = 0;
      for (const f of fixable) {
        /* 念のため、実行時点でも 6 桁のままであることを確認してから更新する
           （dry-run から --apply までの間に手で直された行を上書きしない） */
        const res = await client.query(
          `update public.employees set ${f.zip} = $1
            where id = $2 and length(regexp_replace(${f.zip}, '[^0-9]', '', 'g')) = 6`,
          [f.to, f.id],
        );
        n += res.rowCount;
      }
      await client.query('COMMIT');
      console.log(`\n✅ ${n} 件を更新しました。`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.log('\n!! 更新失敗（ROLLBACK 済み）:', e.message);
      process.exitCode = 1;
    }
  }

  /* 最終状態 */
  for (const { zip, label } of PAIRS) {
    const { rows } = await client.query(`
      select count(*) filter (where length(regexp_replace(${zip},'[^0-9]','','g')) = 7)::int ok,
             count(*) filter (where length(regexp_replace(${zip},'[^0-9]','','g')) <> 7)::int ng
        from public.employees where ${zip} is not null and ${zip} <> ''`);
    console.log(`  ${label}: 正常 ${rows[0].ok} / 異常 ${rows[0].ng}`);
  }
} finally {
  await client.end();
}
