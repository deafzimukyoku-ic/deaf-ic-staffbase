'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { AreaLabel, ChildRow, ScheduleEntryRow } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  child: ChildRow | null;
  date: string | null; // YYYY-MM-DD
  entry: ScheduleEntryRow | null; // 既存エントリ（無ければ null = 新規）
  onSave: (data: {
    attending: boolean;
    pickup_time: string | null;
    dropoff_time: string | null;
    pickup_mark: string | null;
    dropoff_mark: string | null;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function ScheduleCellEditor({ open, onOpenChange, child, date, entry, onSave, onDelete }: Props) {
  const [attending, setAttending] = useState(false);
  const [pickupTime, setPickupTime] = useState('');
  const [dropoffTime, setDropoffTime] = useState('');
  const [pickupMark, setPickupMark] = useState<string>('');
  const [dropoffMark, setDropoffMark] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setAttending(true);
      setPickupTime(entry.pickup_time?.slice(0, 5) ?? '');
      setDropoffTime(entry.dropoff_time?.slice(0, 5) ?? '');
      setPickupMark(entry.pickup_mark ?? '');
      setDropoffMark(entry.dropoff_mark ?? '');
    } else {
      setAttending(false);
      setPickupTime('');
      setDropoffTime('');
      setPickupMark('');
      setDropoffMark('');
    }
  }, [open, entry]);

  if (!child || !date) return null;

  const pickupAreas: AreaLabel[] = (child.custom_pickup_areas || []).filter((a) =>
    (child.pickup_area_labels || []).includes(a.id)
  );
  const dropoffAreas: AreaLabel[] = (child.custom_dropoff_areas || []).filter((a) =>
    (child.dropoff_area_labels || []).includes(a.id)
  );

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        attending,
        pickup_time: attending && pickupTime ? `${pickupTime}:00` : null,
        dropoff_time: attending && dropoffTime ? `${dropoffTime}:00` : null,
        pickup_mark: attending ? (pickupMark || null) : null,
        dropoff_mark: attending ? (dropoffMark || null) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('この日の利用予定を削除しますか？')) return;
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">👶</span>
            <span>{child.name}</span>
            <span className="text-sm text-diletto-gray-light font-normal">· {date}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-2 custom-scrollbar">
          <label className="flex items-center gap-3 rounded-md border border-diletto-gray/10 p-3 cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={attending}
              onChange={(e) => setAttending(e.target.checked)}
              className="h-5 w-5 accent-diletto-blue"
            />
            <div className="flex-1">
              <span className="text-sm font-bold text-diletto-ink">この日に利用する</span>
              <p className="text-[10px] text-diletto-gray-light">チェックを外すとこの日の予定を削除できます</p>
            </div>
          </label>

          {attending && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold">🚐 迎え 時刻</Label>
                  <Input
                    type="time"
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold">🏠 送り 時刻</Label>
                  <Input
                    type="time"
                    value={dropoffTime}
                    onChange={(e) => setDropoffTime(e.target.value)}
                    className="h-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold">🚐 迎えエリア</Label>
                {pickupAreas.length === 0 ? (
                  <p className="text-xs text-diletto-gray-light italic">この児童の迎えエリアが未設定です。児童管理で追加してください。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPickupMark('')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${
                        pickupMark === '' ? 'bg-diletto-gray text-white border-diletto-gray' : 'bg-white text-diletto-gray border-diletto-gray/15'
                      }`}
                    >
                      なし
                    </button>
                    {pickupAreas.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setPickupMark(a.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${
                          pickupMark === a.id ? 'bg-diletto-blue text-white border-diletto-blue' : 'bg-white text-diletto-gray border-diletto-gray/15 hover:border-diletto-blue/30'
                        }`}
                      >
                        {a.emoji} {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold">🏠 送りエリア</Label>
                {dropoffAreas.length === 0 ? (
                  <p className="text-xs text-diletto-gray-light italic">この児童の送りエリアが未設定です。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDropoffMark('')}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${
                        dropoffMark === '' ? 'bg-diletto-gray text-white border-diletto-gray' : 'bg-white text-diletto-gray border-diletto-gray/15'
                      }`}
                    >
                      なし
                    </button>
                    {dropoffAreas.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setDropoffMark(a.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-all ${
                          dropoffMark === a.id ? 'bg-diletto-blue text-white border-diletto-blue' : 'bg-white text-diletto-gray border-diletto-gray/15 hover:border-diletto-blue/30'
                        }`}
                      >
                        {a.emoji} {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {entry && (
            <Button variant="outline" onClick={handleDelete} disabled={saving} className="text-diletto-red mr-auto">
              削除
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>キャンセル</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
