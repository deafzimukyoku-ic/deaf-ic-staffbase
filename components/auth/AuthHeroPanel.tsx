'use client';

/* ─── 認証画面の左側パネル（認定NPO法人 名古屋ろう国際センター ブランド） ─── */
export function AuthHeroPanel() {
  return (
    <>
      <div className="auth-hero-panel" style={{
        background: '#1a1a2e',
        color: '#fff',
        padding: '60px 48px 40px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: '100vh',
      }}>
        {/* ロゴ + サブタイトル（法人名はロゴ画像に含まれているため省略） */}
        <div style={{ marginBottom: 40 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.jpg"
            alt="認定NPO法人 名古屋ろう国際センター"
            style={{ height: 64, width: 'auto', objectFit: 'contain', marginBottom: 16, background: '#fff', borderRadius: 8, padding: 6 }}
          />
          <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', letterSpacing: '0.02em' }}>
            職員ステーション
          </div>
        </div>

        {/* ヘッドライン */}
        <h1 style={{
          fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
          fontWeight: 800,
          lineHeight: 1.4,
          letterSpacing: '0.02em',
          marginBottom: 24,
        }}>
          シフト・職員管理を、<br/>もっとシンプルに。
        </h1>

        {/* 説明文 */}
        <p style={{
          fontSize: '0.95rem',
          lineHeight: 1.8,
          color: 'rgba(255,255,255,0.7)',
          marginBottom: 32,
          maxWidth: 400,
        }}>
          シフト作成・送迎割当・書類・研修・お知らせを<br/>
          ワンストップで管理。事業所運営をシンプルに。
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
            'シフト・送迎担当を半自動で作成',
            '書類提出・研修受講をオンライン完結',
            '遵守事項・お知らせを全職員に即配信',
            '事業所ごとの権限・公開フローを細かく制御',
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
            { value: '4事業所', label: '統合運営' },
            { value: 'ペーパーレス', label: '入退社・書類' },
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
          © 2026 認定NPO法人 名古屋ろう国際センター
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
