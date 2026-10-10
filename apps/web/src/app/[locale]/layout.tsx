import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dirOf, isLocale } from '@/i18n/config';
import { getDict } from '@/i18n';
import '../globals.css';
// Self-hosted (no request to Google Fonts: no third-party IP leakage, no build-time network dependency).
// One family covers Arabic + Latin glyphs, so mixed Arabic/English UI keeps a consistent rhythm.
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import '@fontsource/ibm-plex-sans-arabic/latin-400.css';
import '@fontsource/ibm-plex-sans-arabic/latin-500.css';
import '@fontsource/ibm-plex-sans-arabic/latin-600.css';
import '@fontsource/ibm-plex-sans-arabic/latin-700.css';


export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDict(locale);
  return { title: `${t.brand} — ${t.tagline}`, robots: { index: false, follow: false } };
}

export default async function RootLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const raw = (await cookies()).get('radar_theme')?.value;
  const theme = raw === 'light' || raw === 'dark' ? raw : 'system';
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
