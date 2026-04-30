import type { Metadata } from 'next';
import { Inter, Noto_Sans_JP } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { RoleSwitcher } from '@/components/RoleSwitcher';
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
  icons: {
    icon: '/favicon.svg',
  },
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
      </body>
    </html>
  );
}
