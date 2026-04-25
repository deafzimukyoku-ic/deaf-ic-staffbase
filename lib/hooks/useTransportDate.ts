'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { todayStr } from '@/lib/date/isToday';

/**
 * 送迎表の「表示月 + 選択日」を URL を唯一の真実として扱う派生フック。
 * 元: diletto-shift-maker/src/hooks/useTransportDate.ts を deaf-ic に簡素移植。
 *
 * 差分:
 * - useCurrentStaff / isDateOutOfRange への依存を削除（deaf-ic は employee 側 RLS で制御）
 * - デフォルト月は常に「来月」
 *
 * 不変条件:
 * - 表示月は URL ?month=YYYY-MM（未指定時は来月）
 * - 選択日は URL ?date=YYYY-MM-DD（?month と整合しない値は無効）
 * - 無効/未指定時のフォールバック: sessionStorage[lastDate:月] → 今日（当月なら） → 月初
 * - selectedDate を React state に持たない。setDate() は router.replace で URL 書換のみ
 */

function defaultNextMonthStr(): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

const SESSION_KEY_PREFIX = 'deaf-ic.transport.lastDate:';

export type UseTransportDate = {
  year: number;
  month: number;
  /** "YYYY-MM" */
  monthStr: string;
  /** "YYYY-MM-DD"。常に monthStr 範囲内であることが保証される */
  date: string;
  /** 日付を切り替える。月境界外の値は無視される */
  setDate: (newDate: string) => void;
};

export function useTransportDate(): UseTransportDate {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlMonth = searchParams.get('month');
  const urlDate = searchParams.get('date');

  const { year, month, monthStr } = useMemo(() => {
    /* 年月の決定順: ?date= > ?month= > 来月デフォルト。
       ?date= があれば月情報はそこから導出できるため、URL に ?month= を重ねない（冗長防止）。 */
    let source: string;
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
      source = urlDate.slice(0, 7);
    } else if (urlMonth && /^\d{4}-\d{2}$/.test(urlMonth)) {
      source = urlMonth;
    } else {
      source = defaultNextMonthStr();
    }
    const [y, m] = source.split('-').map(Number);
    return { year: y, month: m, monthStr: source };
  }, [urlMonth, urlDate]);

  /* date は URL のみから決定論的に派生。SSR/初期レンダも同じ結果になる。 */
  const date = useMemo(() => {
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) && urlDate.slice(0, 7) === monthStr) {
      return urlDate;
    }
    const today = todayStr();
    if (today.slice(0, 7) === monthStr) return today;
    return `${monthStr}-01`;
  }, [urlDate, monthStr]);

  /* マウント時 & 月変更時の同期点（1本のみ）:
     - URL ?date が無効/未指定 & sessionStorage に当月保存値あり → URL に昇格
     - URL ?date が不正（月不一致） → URL から削除してフォールバックに委ねる
     - ?date があり、かつ ?month もある場合は ?month を消す（冗長解消）
     これ以降 date は URL だけで完結するので他の useEffect 同期は不要。 */
  useEffect(() => {
    const valid = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) && urlDate.slice(0, 7) === monthStr;
    const hasRedundantMonth = !!urlMonth;

    if (valid && !hasRedundantMonth) return;

    let promoteTo: string | null = null;
    if (!valid) {
      try {
        const saved = window.sessionStorage.getItem(SESSION_KEY_PREFIX + monthStr);
        if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved.slice(0, 7) === monthStr) {
          promoteTo = saved;
        }
      } catch {
        /* sessionStorage 無効環境は無視 */
      }
    }

    if (valid && !hasRedundantMonth) return;
    if (!valid && !promoteTo && !urlMonth) return;

    const params = new URLSearchParams(searchParams.toString());
    if (promoteTo) {
      params.set('date', promoteTo);
    } else if (!valid && urlDate) {
      params.delete('date');
    }

    /* ?date が決まっている場合は ?month を消す */
    if (params.has('date')) {
      params.delete('month');
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [monthStr, urlDate, urlMonth]);

  const setDate = useCallback(
    (newDate: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;

      const newMonthStr = newDate.slice(0, 7);
      /* 月ごとの sessionStorage を更新（跨いだ先の月のキーに保存） */
      try {
        window.sessionStorage.setItem(SESSION_KEY_PREFIX + newMonthStr, newDate);
      } catch {
        /* noop */
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('date', newDate);
      /* URL 整理: ?date= があるので ?month= は常に削除（冗長防止） */
      params.delete('month');

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { year, month, monthStr, date, setDate };
}
