-- 039: 役職へのシステムロール割当機能

-- 1. positions テーブルに system_role カラムを追加
-- 値の制約として employee, manager, admin を許容 (super_admin は個別管理とするため除外が一般的)
ALTER TABLE positions ADD COLUMN system_role text DEFAULT 'employee' CHECK (system_role IN ('employee', 'manager', 'admin'));

-- 2. 既存の役職に対してデフォルト値を設定（必要に応じて）
UPDATE positions SET system_role = 'employee' WHERE system_role IS NULL;

-- 3. トリガーの作成（オプション: 役職変更時に社員のロールを自動更新したい場合）
-- ユーザーは「ややこしいから統合したい」と言っているので、役職側のロールを正とする仕組みを導入します。

CREATE OR REPLACE FUNCTION sync_employee_role_from_position()
RETURNS TRIGGER AS $$
BEGIN
  -- 社員の役職が変更された場合、または役職自体のロールが変更された場合に同期
  -- ここでは「役職自体のロールが変更された場合に、その役職を持つ全社員に波及させる」処理を記述
  IF (TG_OP = 'UPDATE' AND OLD.system_role <> NEW.system_role) THEN
    UPDATE employees SET role = NEW.system_role WHERE position_id = NEW.id AND role <> 'super_admin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_sync_position_role
AFTER UPDATE OF system_role ON positions
FOR EACH ROW EXECUTE FUNCTION sync_employee_role_from_position();

-- 社員側のトリガー（position_id が更新された時に role を同期）
CREATE OR REPLACE FUNCTION sync_employee_role_on_update()
RETURNS TRIGGER AS $$
DECLARE
  target_role text;
BEGIN
  IF (NEW.position_id IS NOT NULL) THEN
    SELECT system_role INTO target_role FROM positions WHERE id = NEW.position_id;
    IF (target_role IS NOT NULL AND NEW.role <> 'super_admin') THEN
      NEW.role := target_role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_employee_position_role_sync
BEFORE INSERT OR UPDATE OF position_id ON employees
FOR EACH ROW EXECUTE FUNCTION sync_employee_role_on_update();
