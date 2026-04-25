/**
 * 簡易関数パーサー
 * 対応関数: SUM, AVERAGE, IF, CONCAT のみ
 * それ以外は #UNSUPPORTED を返す
 */

const SUPPORTED_FUNCTIONS = ['SUM', 'AVERAGE', 'IF', 'CONCAT'] as const;

type CellResolver = (ref: string) => string;

/**
 * セル値を評価する
 * @param value セルに入力された値（=で始まる場合は関数として評価）
 * @param resolve 他セルの値を解決する関数 (例: "A2" → "100")
 * @returns 評価結果の文字列
 */
export function evaluateCell(
  value: string,
  resolve: CellResolver
): string {
  if (!value.startsWith('=')) return value;

  const formula = value.slice(1).trim();
  const match = formula.match(/^(\w+)\(([\s\S]+)\)$/);

  if (!match) return '#ERROR';

  const funcName = match[1].toUpperCase();
  const argsStr = match[2];

  if (!(SUPPORTED_FUNCTIONS as readonly string[]).includes(funcName)) {
    return '#UNSUPPORTED';
  }

  try {
    switch (funcName) {
      case 'SUM':
        return evaluateSum(argsStr, resolve);
      case 'AVERAGE':
        return evaluateAverage(argsStr, resolve);
      case 'IF':
        return evaluateIf(argsStr, resolve);
      case 'CONCAT':
        return evaluateConcat(argsStr, resolve);
      default:
        return '#UNSUPPORTED';
    }
  } catch {
    return '#ERROR';
  }
}

/** 範囲 "A1:A5" または "A1,A2,A3" をセル参照リストに展開 */
function expandRange(rangeStr: string): string[] {
  const refs: string[] = [];
  const parts = rangeStr.split(',').map((s) => s.trim());

  for (const part of parts) {
    if (part.includes(':')) {
      const [start, end] = part.split(':').map((s) => s.trim());
      const colStart = start.replace(/[0-9]/g, '');
      const rowStart = parseInt(start.replace(/[^0-9]/g, ''), 10);
      const rowEnd = parseInt(end.replace(/[^0-9]/g, ''), 10);

      for (let r = rowStart; r <= rowEnd; r++) {
        refs.push(`${colStart}${r}`);
      }
    } else {
      refs.push(part);
    }
  }

  return refs;
}

/** セル参照リストの値を数値配列として取得 */
function resolveNumbers(argsStr: string, resolve: CellResolver): number[] {
  const refs = expandRange(argsStr);
  return refs
    .map((ref) => resolve(ref))
    .map((v) => parseFloat(v.replace(/,/g, '')))
    .filter((n) => !isNaN(n));
}

function evaluateSum(argsStr: string, resolve: CellResolver): string {
  const nums = resolveNumbers(argsStr, resolve);
  if (nums.length === 0) return '0';
  return String(nums.reduce((a, b) => a + b, 0));
}

function evaluateAverage(argsStr: string, resolve: CellResolver): string {
  const nums = resolveNumbers(argsStr, resolve);
  if (nums.length === 0) return '0';
  return String(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function evaluateIf(argsStr: string, resolve: CellResolver): string {
  const args = splitTopLevelCommas(argsStr);
  if (args.length < 3) return '#ERROR';

  const condition = args[0].trim();
  const trueVal = args[1].trim();
  const falseVal = args[2].trim();

  const result = evaluateCondition(condition, resolve);
  return result ? resolveValue(trueVal, resolve) : resolveValue(falseVal, resolve);
}

function evaluateConcat(argsStr: string, resolve: CellResolver): string {
  const args = splitTopLevelCommas(argsStr);
  return args.map((a) => resolveValue(a.trim(), resolve)).join('');
}

/** トップレベルのカンマで分割（括弧内のカンマは無視） */
function splitTopLevelCommas(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  result.push(current);
  return result;
}

/** 条件を評価 (簡易: >, <, >=, <=, ==, != のみ) */
function evaluateCondition(condition: string, resolve: CellResolver): boolean {
  const operators = ['>=', '<=', '!=', '==', '>', '<'] as const;

  for (const op of operators) {
    const idx = condition.indexOf(op);
    if (idx !== -1) {
      const left = resolveValue(condition.slice(0, idx).trim(), resolve);
      const right = resolveValue(condition.slice(idx + op.length).trim(), resolve);
      const lNum = parseFloat(left);
      const rNum = parseFloat(right);
      const isNumeric = !isNaN(lNum) && !isNaN(rNum);

      switch (op) {
        case '>': return isNumeric ? lNum > rNum : left > right;
        case '<': return isNumeric ? lNum < rNum : left < right;
        case '>=': return isNumeric ? lNum >= rNum : left >= right;
        case '<=': return isNumeric ? lNum <= rNum : left <= right;
        case '==': return left === right;
        case '!=': return left !== right;
      }
    }
  }

  const val = resolveValue(condition, resolve);
  return val !== '' && val !== '0' && val !== 'false';
}

/** 値を解決: セル参照なら解決、文字列リテラルならクォート除去 */
function resolveValue(val: string, resolve: CellResolver): string {
  // 文字列リテラル ("xxx" or 'xxx')
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }

  // 数値リテラル
  if (!isNaN(parseFloat(val)) && /^[\d.,\-]+$/.test(val)) {
    return val;
  }

  // セル参照
  if (/^[A-Z]+\d+$/i.test(val)) {
    return resolve(val);
  }

  return val;
}
