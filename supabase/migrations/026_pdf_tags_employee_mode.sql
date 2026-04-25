-- 026: pdf_tags.column_key を拡張（employee mode のドット記法対応）
-- 例: "employee.last_name", "tenant.company_name", "fixed.today"
-- 既存の "col_A", "col_B" 等はそのまま動作

ALTER TABLE pdf_tags ALTER COLUMN column_key TYPE varchar(100);
