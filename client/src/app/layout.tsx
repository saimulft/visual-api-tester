import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Onest, Plus_Jakarta_Sans } from 'next/font/google';
import { Toaster } from '@/components/ui/toast';
import './globals.css';

// The canvas's three families, self-hosted by next/font under the variables tokens.css reads.
const onest = Onest({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-onest', display: 'swap' });
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});
const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Dialed', template: '%s · Dialed' },
  description:
    'Get data from any API without writing code. Your AI reads the docs and turns the API into dials you set by hand.',
  applicationName: 'Dialed',
};

export const viewport: Viewport = { themeColor: '#ffffff', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${onest.variable} ${jakarta.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
