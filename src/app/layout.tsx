import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Guru — Cross-Tradition Esoteric Research',
  description:
    'Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot, Neoplatonic emanations, and Vedantic consciousness — traced to their sources, every claim cited.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
