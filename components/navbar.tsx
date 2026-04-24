"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen } from 'lucide-react'

export default function Navbar() {
  const pathname = usePathname()

  return (
    <header className="w-full border-b border-border/30">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4 md:px-6">
        <Link href="/ledger" className="flex items-center gap-2 font-semibold tracking-tight text-xl">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-white">
            <BookOpen className="h-4 w-4" />
          </div>
          <span>Decision Ledger</span>
        </Link>
        <nav className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
          <Link
            href="/ledger"
            className={[
              'hover:text-foreground transition-colors',
              pathname === '/ledger' ? 'text-foreground font-medium' : '',
            ].join(' ')}
          >
            Timeline
          </Link>
        </nav>
      </div>
    </header>
  )
}
