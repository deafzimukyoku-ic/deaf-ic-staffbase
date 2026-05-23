import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_JP } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { RoleSwitcher } from '@/components/RoleSwitcher';
import { PushSWRegister } from '@/components/PushSWRegister';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const notoSansJP = Noto_Sans_JP({
  variable: '--font-noto-sans-jp',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: '名古屋ろう国際センター 職員ステーション',
  description: '認定NPO法人 名古屋ろう国際センターの職員向け統合管理システム — シフト・送迎・書類・研修・お知らせをワンストップで管理',
  manifest: '/manifest.webmanifest',
  applicationName: '職員ステーション',
  appleWebApp: {
    capable: true,
    title: '職員ステーション',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.svg' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180-apple.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#1A1A1A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJP.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <RoleSwitcher />
        <Toaster />
        <PushSWRegister />
      </body>
    </html>
  );
}
