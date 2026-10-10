import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const arabicFont = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'راصد — Growth Radar for Salla',
  description: 'رادار النمو لمتاجر سلة: أسعار المنافسين، ثقة البيانات، وتوصيات القرار.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={arabicFont.variable}>
      <body className="min-h-screen bg-white font-sans text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
