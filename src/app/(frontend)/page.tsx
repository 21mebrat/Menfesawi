import React from 'react'
import { headers as getHeaders } from 'next/headers'
import Link from 'next/link'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function HomePage() {
  const headers = await getHeaders()
  const config = await configPromise
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <div className="text-center space-y-4">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          መንፈሳዊ (Menfesawi)
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
          Ethiopian Orthodox Tewahedo sacred reading, scripture, and learning application.
        </p>

        <div className="flex items-center justify-center gap-3 pt-4">
          {user ? (
            <>
              <Link href="/account">
                <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                  View Account
                </Button>
              </Link>
              {(user as any).role === 'admin' || (user as any).role === 'editor' ? (
                <Link href="/admin">
                  <Button variant="outline">Admin Dashboard</Button>
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <Link href="/login">
                <Button className="bg-primary text-primary-foreground hover:bg-primary-hover">
                  Sign In / Register
                </Button>
              </Link>
              <Link href="/api/auth/google">
                <Button variant="outline">Continue with Google</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Holy Scriptures</CardTitle>
            <CardDescription>
              Orthodox Canon Bible books, chapters, and verses.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Daily Synaxarium</CardTitle>
            <CardDescription>
              Commemorations of holy fathers, martyrs, and saints.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Prayers &amp; Praises</CardTitle>
            <CardDescription>
              Waddase Maryam, Melka Kidusan, and liturgical hymns.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
