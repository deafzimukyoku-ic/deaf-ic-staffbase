/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ShiftPuzzle 本家 Supabase から
 *  - tenants.settings (pickup_areas / dropoff_areas / その他設定)
 *  - children (送迎エリア・カスタムエリア含む)
 * を取得して、deaf-ic 側の「パズル」facility に紐づける ETL スクリプト。
 *
 * 実行: PUZZLE_KEY=... PUZZLE_URL=... npx tsx scripts/seed-from-shift-puzzle.ts
 *
 * 注意:
 * - スタッフ・schedule_entries は対象外（ユーザー指示）
 * - deaf-ic の pickup_area_labels/dropoff_area_labels (text[]) は children では「id 配列」として扱う
 * - facility_shift_settings.pickup_area_labels は jsonb として AreaLabel オブジェクト配列を持つ
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// .env.local 読み込み（Next が起動していなくても動くよう簡易パース）
function loadEnv() {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* ignore */ }
}
loadEnv();

const PUZZLE_URL = process.env.PUZZLE_URL ?? 'https://munermdzzygwlpxsfyar.supabase.co';
const PUZZLE_KEY = process.env.PUZZLE_KEY ?? '';
const DEAF_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const DEAF_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!PUZZLE_KEY) { console.error('PUZZLE_KEY が未設定'); process.exit(1); }
if (!DEAF_URL || !DEAF_KEY) { console.error('deaf-ic 側の SUPABASE_URL / SERVICE_ROLE_KEY が未設定'); process.exit(1); }

const puzzle = createClient(PUZZLE_URL, PUZZLE_KEY, { auth: { persistSession: false } });
const deaf = createClient(DEAF_URL, DEAF_KEY, { auth: { persistSession: false } });

const FACILITY_NAME = 'パズル';

async function main() {
  console.log('--- ShiftPuzzle → deaf-ic シード ---');

  // 1. deaf-ic の tenant + facility 取得
  const { data: facilities, error: fErr } = await deaf
    .from('facilities')
    .select('id, name, tenant_id')
    .eq('name', FACILITY_NAME);
  if (fErr) throw fErr;
  if (!facilities || facilities.length === 0) {
    throw new Error(`facility name='${FACILITY_NAME}' が deaf-ic に見つかりません`);
  }
  if (facilities.length > 1) {
    throw new Error(`facility name='${FACILITY_NAME}' が deaf-ic に複数あります（${facilities.length}件）。手動で1件に絞ってください。`);
  }
  const { id: facilityId, tenant_id: tenantId } = facilities[0];
  console.log(`✓ deaf-ic facility: ${FACILITY_NAME} (id=${facilityId}, tenant=${tenantId})`);

  // 2. shift-puzzle 側の tenant.settings 取得
  const { data: puzzleTenants, error: pErr } = await puzzle.from('tenants').select('id, name, settings');
  if (pErr) throw pErr;
  if (!puzzleTenants || puzzleTenants.length === 0) throw new Error('shift-puzzle に tenant が無い');
  const puzzleTenant = puzzleTenants[0];
  console.log(`✓ puzzle tenant: ${puzzleTenant.name} (id=${puzzleTenant.id})`);
  const settings: any = puzzleTenant.settings ?? {};

  // 3. facility_shift_settings に upsert
  const fssPayload = {
    facility_id: facilityId,
    tenant_id: tenantId,
    min_qualified_staff: settings.min_qualified_staff ?? 2,
    pickup_area_labels: settings.pickup_areas ?? [],
    dropoff_area_labels: settings.dropoff_areas ?? [],
    qualification_types: settings.qualification_types ?? [],
    request_deadline_day: settings.request_deadline_day ?? 20,
    transport_min_end_time: settings.transport_min_end_time ?? '15:00:00',
    transport_pickup_cooldown_minutes: settings.transport_pickup_cooldown_minutes ?? 30,
    updated_at: new Date().toISOString(),
  };
  const { error: fssErr } = await deaf
    .from('facility_shift_settings')
    .upsert(fssPayload, { onConflict: 'facility_id' });
  if (fssErr) throw fssErr;
  console.log(`✓ facility_shift_settings 更新（pickup ${fssPayload.pickup_area_labels.length}件 / dropoff ${fssPayload.dropoff_area_labels.length}件）`);

  // 4. shift-puzzle の children 全件取得
  const { data: puzzleChildren, error: cErr } = await puzzle.from('children').select('*');
  if (cErr) throw cErr;
  console.log(`✓ puzzle children: ${puzzleChildren?.length ?? 0}件`);

  if (!puzzleChildren || puzzleChildren.length === 0) {
    console.log('children が無いので終了');
    return;
  }

  // 5. deaf-ic 側の既存 children（同 facility）を取得し、name でマッチング判定
  const { data: existingChildren, error: ecErr } = await deaf
    .from('children')
    .select('id, name')
    .eq('facility_id', facilityId);
  if (ecErr) throw ecErr;
  const existingByName = new Map<string, string>(
    (existingChildren ?? []).map((c: any) => [c.name as string, c.id as string])
  );

  // 6. children を deaf-ic スキーマに変換して INSERT/UPDATE
  let inserted = 0;
  let updated = 0;
  for (const ch of puzzleChildren) {
    const payload = {
      tenant_id: tenantId,
      facility_id: facilityId,
      name: ch.name,
      grade_type: ch.grade_type,
      is_active: ch.is_active ?? true,
      display_order: ch.display_order ?? null,
      home_address: ch.home_address ?? null,
      parent_contact: ch.parent_contact ?? null,
      pickup_area_labels: ch.pickup_area_labels ?? [],
      dropoff_area_labels: ch.dropoff_area_labels ?? [],
      custom_pickup_areas: ch.custom_pickup_areas ?? [],
      custom_dropoff_areas: ch.custom_dropoff_areas ?? [],
    };

    const existId = existingByName.get(ch.name);
    if (existId) {
      const { error } = await deaf.from('children').update(payload).eq('id', existId);
      if (error) { console.error(`  ✗ update ${ch.name}:`, error.message); continue; }
      updated++;
    } else {
      const { error } = await deaf.from('children').insert(payload);
      if (error) { console.error(`  ✗ insert ${ch.name}:`, error.message); continue; }
      inserted++;
    }
  }
  console.log(`✓ children: insert ${inserted} / update ${updated}`);

  console.log('--- 完了 ---');
}

main().catch((e) => { console.error(e); process.exit(1); });
