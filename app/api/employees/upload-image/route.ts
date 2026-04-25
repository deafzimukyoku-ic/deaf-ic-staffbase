import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// DB更新専用API（画像はクライアントからSupabase Storageに直接アップロード済み）
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const { data: me } = await supabase
      .from('employees')
      .select('id, tenant_id, role')
      .eq('auth_user_id', user.id)
      .single();

    if (!me) {
      return NextResponse.json({ error: '社員情報が見つかりません' }, { status: 404 });
    }

    const body = await req.json() as {
      field_key: string;
      storage_path: string;
      employee_id?: string;
    };

    const { field_key, storage_path, employee_id } = body;

    if (!field_key || !storage_path) {
      return NextResponse.json({ error: 'field_keyとstorage_pathが必要です' }, { status: 400 });
    }

    const targetEmployeeId = employee_id || me.id;

    // 管理者が他の社員を更新する場合の権限チェック
    if (targetEmployeeId !== me.id) {
      if (me.role !== 'admin') {
        return NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 });
      }
    }

    const adminClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // 固定カラム（license_image_path, commute_route_image_path）の場合はemployeesテーブルを更新
    const fixedImageColumns = ['license_image_path', 'commute_route_image_path'];
    if (fixedImageColumns.includes(field_key)) {
      await adminClient
        .from('employees')
        .update({ [field_key]: storage_path })
        .eq('id', targetEmployeeId);
    } else {
      // カスタムフィールドの画像 → employees.custom_fields に保存
      const { data: emp } = await adminClient
        .from('employees')
        .select('custom_fields')
        .eq('id', targetEmployeeId)
        .single();

      const customFields = (emp?.custom_fields as Record<string, string>) || {};
      customFields[field_key] = storage_path;

      await adminClient
        .from('employees')
        .update({ custom_fields: customFields })
        .eq('id', targetEmployeeId);
    }

    // 公開URLを生成
    const { data: urlData } = adminClient.storage
      .from('employee-images')
      .getPublicUrl(storage_path);

    return NextResponse.json({
      path: storage_path,
      url: urlData.publicUrl,
    });
  } catch {
    return NextResponse.json({ error: '画像情報の更新中にエラーが発生しました' }, { status: 500 });
  }
}
