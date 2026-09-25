import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sayseed · 让表达生根',
  description: '在真实语境中学会新表达。',
  applicationName: 'Sayseed',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Sayseed', statusBarStyle: 'default' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f8f7f2' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Browser extensions such as Immersive Translate add attributes before hydration.
  // Limit suppression to the root element so descendant mismatches remain visible.
  return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>;
}
