'use client';

const SITE = 'https://www.diletto-s.com';

const FOOTER_MAP = [
  {
    title: 'サービス内容',
    links: [
      { label: '業務自動化・VBA/GAS', href: `${SITE}/#services` },
      { label: '仕組み化・マニュアル化', href: `${SITE}/#services` },
      { label: 'SaaS・Webアプリ開発', href: `${SITE}/#services` },
      { label: 'AI導入・プロンプト設計', href: `${SITE}/#services` },
    ],
  },
  {
    title: '強み・実績',
    links: [
      { label: '導入メリット', href: `${SITE}/#metrics` },
      { label: '支援実績一覧', href: `${SITE}/cases` },
      { label: 'シフト自動生成の事例', href: `${SITE}/cases#case1` },
      { label: 'PDF・メール自動化の事例', href: `${SITE}/cases#case5` },
    ],
  },
  {
    title: 'diletto by AI Skill Exchangeについて',
    links: [
      { label: '会社概要・運営者情報', href: `${SITE}/company` },
      { label: 'プライバシーポリシー', href: `${SITE}/privacy` },
      { label: '利用規約', href: `${SITE}/terms` },
      { label: '特定商取引法に基づく表記', href: `${SITE}/tokushoho` },
    ],
  },
];

const FOOTER_BOTTOM_LINKS = [
  { label: 'プライバシーポリシー', href: `${SITE}/privacy` },
  { label: '利用規約', href: `${SITE}/terms` },
  { label: '特商法表記', href: `${SITE}/tokushoho` },
  { label: '会社概要・運営者情報', href: `${SITE}/company` },
];

/* ─── フッター（diletto_assets/common.js / common.css 準拠） ─── */
export function DilettoFooter() {
  const mapTitleStyle: React.CSSProperties = {
    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.1em', color: '#a8a8a0', marginBottom: 20,
  };
  const mapLinkStyle: React.CSSProperties = {
    fontSize: '0.9rem', color: '#5a5a55', textDecoration: 'none', transition: 'color 0.3s ease',
  };

  return (
    <footer
      style={{ background: '#f5f4f0', borderTop: '1px solid rgba(0,0,0,0.2)', padding: '60px 0 40px' }}
    >
      <div className="footer-wrap-inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 48px' }}>
        {/* ── Footer top: brand + sitemap ── */}
        <div
          className="footer-top-grid"
          style={{
            display: 'grid', gridTemplateColumns: '200px 1fr', gap: 40,
            marginBottom: 48, paddingBottom: 48,
            borderBottom: '1px solid rgba(0,0,0,0.1)',
          }}
        >
          {/* ブランド */}
          <div>
            <div className="footer-brand-name" style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.1em', color: '#111', marginBottom: 8 }}>
              diletto by AI Skill Exchange
            </div>
            <div className="footer-brand-tag" style={{ fontSize: '0.9rem', color: '#a8a8a0' }}>
              業務を、仕組みに変える。
            </div>
          </div>

          {/* サイトマップ 4列 */}
          <div
            className="footer-map-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 40 }}
          >
            {FOOTER_MAP.map((col) => (
              <div key={col.title}>
                <div className="f-map-title" style={mapTitleStyle}>{col.title}</div>
                <div className="f-map-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {col.links.map((l) => (
                    <a key={l.label} href={l.href} className="f-map-link" style={mapLinkStyle}>{l.label}</a>
                  ))}
                </div>
              </div>
            ))}
            {/* お問い合わせ列 */}
            <div>
              <div className="f-map-title" style={mapTitleStyle}>お問い合わせ</div>
              <div className="f-map-list" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <a href={`${SITE}/#cta`} className="f-map-link" style={mapLinkStyle}>無料相談・お見積もり</a>
                <a href="tel:07094442460" className="f-map-link" style={mapLinkStyle}>070-9444-2460</a>
                <p className="f-map-note" style={{ fontSize: '0.75rem', color: '#a8a8a0', marginTop: 8 }}>
                  平日 10:00〜19:00 受付
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer bottom ── */}
        <div
          className="footer-bottom-bar"
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            flexWrap: 'wrap', gap: 16,
            fontSize: '0.85rem', color: '#a8a8a0',
            marginTop: 48, paddingTop: 32,
            borderTop: '1px solid rgba(0,0,0,0.1)',
          }}
        >
          <span>&copy; 2026 diletto by AI Skill Exchange. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 24 }}>
            {FOOTER_BOTTOM_LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                style={{ color: '#a8a8a0', textDecoration: 'none', transition: 'color 0.3s ease' }}
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* ── レスポンシブ + ホバー ── */}
      <style>{`
        .f-map-link:hover { color: #1a3eb8 !important; }
        .footer-bottom-bar a:hover { color: #5a5a55 !important; }
        @media (max-width: 1060px) {
          .footer-wrap-inner { padding: 0 24px !important; }
          .footer-top-grid { grid-template-columns: 1fr !important; }
          .footer-map-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 20px 16px !important; }
          footer { padding: 32px 0 16px !important; }
          .footer-brand-name { font-size: 0.9rem !important; margin-bottom: 2px !important; }
          .footer-brand-tag { font-size: 0.75rem !important; margin-bottom: 20px !important; }
          .f-map-title { font-size: 0.7rem !important; margin-bottom: 6px !important; }
          .f-map-list { gap: 5px !important; }
          .f-map-link { font-size: 0.75rem !important; line-height: 1.4 !important; }
          .f-map-note { font-size: 0.68rem !important; margin-top: 4px !important; }
          .footer-bottom-bar {
            flex-direction: column !important; align-items: flex-start !important;
            gap: 8px !important; margin-top: 24px !important; padding-top: 16px !important;
            font-size: 0.72rem !important;
          }
          .footer-bottom-bar > div { gap: 16px !important; font-size: 0.72rem !important; }
        }
      `}</style>
    </footer>
  );
}
