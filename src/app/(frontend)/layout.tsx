import React from 'react'
import '../global.css'

export const metadata = {
  title: 'Menfesawi - Ethiopian Orthodox Tewahedo Reader',
  description: 'Ethiopian Orthodox Tewahedo reading and learning platform.',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <a href="/" className="font-heading text-lg font-semibold text-primary">
              Menfesawi
            </a>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <a href="/login" className="text-muted-foreground hover:text-foreground">
                Sign In
              </a>
              <a
                href="/account"
                className="rounded-4xl bg-primary px-3.5 py-1.5 text-primary-foreground hover:bg-primary-hover"
              >
                My Account
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
