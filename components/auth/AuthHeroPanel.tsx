'use client';

/* ─── 左側の紹介パネル（スプリットレイアウト用） ─── */
export function AuthHeroPanel() {
  return (
    <>
      <div className="auth-hero-panel" style={{
        background: '#111',
        color: '#fff',
        padding: '60px 48px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        {/* ロゴ */}
        <div style={{ marginBottom: 40 }}>
          <a href="https://www.diletto-s.com/" style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.12em', textDecoration: 'none', color: '#fff' }}>
            di<em style={{ fontStyle: 'normal', color: '#5b7fff' }}>letto</em>{' '}
            <span style={{ fontSize: '0.62em', fontWeight: 600, opacity: 0.8 }}>
              by <span style={{ color: '#4adb5e' }}>AI Skill</span> Exchange
            </span>
          </a>
        </div>

        {/* ヘッドライン */}
        <h1 style={{
          fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
          fontWeight: 800,
          lineHeight: 1.4,
          letterSpacing: '0.02em',
          marginBottom: 24,
        }}>
          社員管理を、<br/>もっとシンプルに。
        </h1>

        {/* 説明文 */}
        <p style={{
          fontSize: '0.95rem',
          lineHeight: 1.8,
          color: 'rgba(255,255,255,0.7)',
          marginBottom: 32,
          maxWidth: 400,
        }}>
          入退社書類・研修・遵守事項・お知らせを<br/>
          ワンストップで管理。紙の手続きから卒業しませんか。
        </p>

        {/* 特徴リスト */}
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: '0 0 40px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          {[
            '入社書類をオンラインで完結。ブラウザだけでOK',
            '研修・遵守事項の管理を一元化',
            'お知らせ・通知を全社員に即配信',
            '金額異常・表記ゆれを自動チェック。ミスを未然に防止',
          ].map((text) => (
            <li key={text} style={{
              fontSize: '0.9rem',
              color: 'rgba(255,255,255,0.85)',
              paddingLeft: 20,
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute',
                left: 0,
                top: 2,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#5b7fff',
              }} />
              {text}
            </li>
          ))}
        </ul>

        {/* 指標 */}
        <div style={{
          display: 'flex',
          gap: 32,
          marginBottom: 32,
        }}>
          {[
            { value: '3ステップ', label: 'で導入完了' },
            { value: 'ペーパーレス', label: '入社手続き' },
            { value: '自動', label: '通知・リマインド' },
          ].map((m) => (
            <div key={m.value}>
              <div style={{
                fontSize: '1.3rem',
                fontWeight: 800,
                color: '#fff',
                letterSpacing: '0.02em',
              }}>
                {m.value}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: 'rgba(255,255,255,0.5)',
                marginTop: 2,
              }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>

        {/* コピーライト */}
        <div style={{
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.35)',
          marginTop: 'auto',
        }}>
          © 2026 diletto by AI Skill Exchange. All rights reserved.
        </div>
      </div>

      {/* モバイルではパネル非表示 */}
      <style>{`
        @media (max-width: 900px) {
          .auth-hero-panel { display: none !important; }
        }
      `}</style>
    </>
  );
}
