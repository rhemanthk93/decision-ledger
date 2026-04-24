import type { Metadata } from 'next'
import './globals.css'
import { ThemeProvider } from '@/components/providers/theme-provider'
import Navbar from '@/components/navbar'

export const metadata: Metadata = {
  title: 'Decision Ledger',
  description: 'Track company decisions with provenance, temporal ordering, and contradiction detection',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Navbar />
          <main className="min-h-[calc(100vh-56px)]">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
