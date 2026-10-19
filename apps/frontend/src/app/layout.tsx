import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ToastProvider } from './toast';

export const metadata: Metadata = {
  title: 'راصد — Growth Radar for Salla',
  description: 'رادار النمو لمتاجر سلة: أسعار المنافسين، ثقة البيانات، وتوصيات القرار.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-white font-sans text-slate-900 antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
