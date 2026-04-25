'use client';

import { useState } from 'react';

const SITE = 'https://www.diletto-s.com';

const MOBILE_LINKS = [
  { label: '今すぐ業務を楽にする！', href: `${SITE}/apps`, style: { color: '#e86c2e', fontWeight: 700 } as React.CSSProperties },
  { label: 'トップページ', href: SITE },
  { label: '制作実績', href: `${SITE}/works` },
  { label: 'ビフォーアフター', href: `${SITE}/before-after` },
  { label: '支援実績・事例', href: `${SITE}/cases` },
  { label: 'お知らせ', href: `${SITE}/news` },
  { label: '会社概要', href: `${SITE}/company` },
  { label: '無料相談を申し込む', href: `${SITE}/#cta`, style: { color: '#1a3eb8' } as React.CSSProperties },
];

/* ─── ヘッダー（diletto_assets/common.js / common.css 準拠） ─── */
export function DilettoHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  function toggleMenu() {
    setMenuOpen((prev) => !prev);
  }

  return (
    <>
      {/* ── NAV BAR ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between"
        style={{
          height: 60,
          padding: '0 48px',
          background: 'rgba(245,244,240,0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        {/* ロゴ */}
        <a
          href={SITE}
          style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.12em', color: '#111', textDecoration: 'none' }}
        >
          di<em style={{ fontStyle: 'normal', color: '#1a3eb8' }}>letto</em>{' '}
          <span style={{ fontSize: '0.62em', fontWeight: 600, opacity: 1 }}>
            by <span style={{ color: '#2e9e46' }}>AI Skill</span> Exchange
          </span>
        </a>

        {/* ── nav-center（diletto_assets/common.js と同じ構造、CSSで非表示） ── */}
        <div className="nav-center" style={{ display: 'none' }}>
          <a href={`${SITE}/#problems`}>課題</a>
          <a href={`${SITE}/#ba`}>ビフォーアフター</a>
          <a href={`${SITE}/#metrics`}>導入効果</a>
          <a href={`${SITE}/#cases`}>実績</a>
          <a href={`${SITE}/#services`}>サービス</a>
        </div>

        {/* 右側: CTA + ハンバーガー */}
        <div className="flex items-center gap-3">
          <a
            href={`${SITE}/apps`}
            className="nav-cta-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 22px',
              borderRadius: 4,
              background: '#e86c2e',
              color: '#fff',
              fontSize: '0.9rem',
              fontWeight: 700,
              letterSpacing: '0.03em',
              textDecoration: 'none',
              transition: 'background 0.3s ease, transform 0.3s ease',
            }}
          >
            今すぐ業務を楽にする！
          </a>
          {/* ハンバーガー */}
          <div
            onClick={toggleMenu}
            style={{ cursor: 'pointer', width: 24, height: 18, position: 'relative', zIndex: 200 }}
            role="button"
            aria-label={menuOpen ? 'メニューを閉じる' : 'メニューを開く'}
          >
            <span
              style={{
                display: 'block', width: '100%', height: 2, background: '#111',
                position: 'absolute', transition: '0.3s',
                top: menuOpen ? 8 : 0,
                transform: menuOpen ? 'rotate(45deg)' : 'none',
              }}
            />
            <span
              style={{
                display: 'block', width: '100%', height: 2, background: '#111',
                position: 'absolute', top: 8, transition: '0.3s',
                opacity: menuOpen ? 0 : 1,
              }}
            />
            <span
              style={{
                display: 'block', width: '100%', height: 2, background: '#111',
                position: 'absolute', transition: '0.3s',
                top: menuOpen ? 8 : 16,
                transform: menuOpen ? 'rotate(-45deg)' : 'none',
              }}
            />
          </div>
        </div>
      </nav>

      {/* ── モバイル背景 ── */}
      <div
        onClick={toggleMenu}
        style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.2)',
          opacity: menuOpen ? 1 : 0,
          visibility: menuOpen ? 'visible' : 'hidden',
          transition: '0.3s',
          zIndex: 999,
        }}
      />

      {/* ── モバイルスライドメニュー ── */}
      <div
        style={{
          position: 'fixed', top: 0,
          right: menuOpen ? 0 : -300,
          width: 280, height: '100vh',
          background: '#fff',
          boxShadow: '-10px 0 30px rgba(0,0,0,0.1)',
          transition: '0.4s cubic-bezier(0.16,1,0.3,1)',
          display: 'flex', flexDirection: 'column',
          zIndex: 1000, color: '#111',
        }}
      >
        {/* メニューヘッダー */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '20px 24px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}
        >
          <a
            href={SITE}
            style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.12em', color: '#111', textDecoration: 'none' }}
          >
            di<em style={{ fontStyle: 'normal', color: '#1a3eb8' }}>letto</em>{' '}
            <span style={{ fontSize: '0.62em', fontWeight: 600, opacity: 1 }}>
              by <span style={{ color: '#2e9e46' }}>AI Skill</span> Exchange
            </span>
          </a>
          <button
            onClick={toggleMenu}
            aria-label="Close menu"
            style={{
              width: 36, height: 36, borderRadius: 4,
              border: '1px solid rgba(0,0,0,0.2)',
              background: '#f5f4f0', color: '#111',
              fontSize: '1.2rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            &times;
          </button>
        </div>

        {/* メニューリンク */}
        <div
          style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}
        >
          {MOBILE_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={toggleMenu}
              style={{
                fontSize: '1.1rem', fontWeight: 700, color: '#111',
                textDecoration: 'none', padding: '12px 0',
                borderBottom: '1px solid rgba(0,0,0,0.1)',
                transition: 'color 0.2s',
                ...('style' in l && l.style ? l.style : {}),
              }}
            >
              {l.label}
            </a>
          ))}
        </div>

        {/* メニューフッター */}
        <div style={{ padding: 24, background: '#f5f4f0', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          <div style={{ color: '#a8a8a0', fontSize: '0.75rem', fontWeight: 700, marginBottom: 4 }}>
            Contact
          </div>
          <a
            href="tel:07094442460"
            style={{ display: 'block', color: '#111', fontSize: '1.2rem', fontWeight: 800, textDecoration: 'none' }}
          >
            070-9444-2460
          </a>
        </div>
      </div>

      {/* ── レスポンシブ ── */}
      <style>{`
        @media (max-width: 1060px) {
          nav.fixed { padding: 0 24px !important; }
          .nav-cta-btn { padding: 8px 16px !important; font-size: 0.8rem !important; }
        }
      `}</style>
    </>
  );
}
