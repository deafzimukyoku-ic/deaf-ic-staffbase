'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  value: string;
  displayValue: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  isHeader?: boolean;
}

export default function MatrixCell({
  value,
  displayValue,
  onChange,
  onBlur,
  isHeader = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  function handleDoubleClick() {
    setEditing(true);
    setEditValue(value);
  }

  function handleBlur() {
    setEditing(false);
    if (editValue !== value) {
      onChange(editValue);
    }
    onBlur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setEditing(false);
      setEditValue(value);
    }
  }

  const isError = displayValue === '#ERROR' || displayValue === '#UNSUPPORTED';

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`w-full h-full px-2 py-1.5 text-sm border-2 border-diletto-blue outline-none ${
          isHeader ? 'font-semibold bg-diletto-blue/10' : 'bg-white'
        }`}
      />
    );
  }

  return (
    <div
      onDoubleClick={handleDoubleClick}
      onClick={() => { if (isHeader) { setEditing(true); setEditValue(value); } }}
      className={`w-full h-full px-2 py-1.5 text-sm truncate cursor-default select-none ${
        isHeader
          ? 'font-semibold bg-diletto-blue/10 text-diletto-blue cursor-text'
          : isError
          ? 'text-diletto-red bg-diletto-red/5'
          : ''
      }`}
      title={value !== displayValue ? `式: ${value}` : undefined}
    >
      {displayValue || (isHeader ? 'クリックして入力' : '')}
    </div>
  );
}
