import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'RadixAI — Research Crawler', description: 'Trace the web. Connect the evidence. A research crawler for finance, business, technology, and case studies.', icons: { icon: '/favicon.svg' } };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
