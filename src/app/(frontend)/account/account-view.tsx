'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface AccountViewProps {
  user: {
    id: string
    email: string
    name: string
    role: string
    avatarURL?: string
    isActive: boolean
    hasPassword: boolean
  }
  linkedAccounts: Array<{
    id: string
    provider: string
    providerAccountId: string
    createdAt?: string
  }>
  banner: { type: 'success' | 'info' | 'error'; message: string } | null
}

export default function AccountView({
  user,
  linkedAccounts: initialAccounts,
  banner: initialBanner,
}: AccountViewProps) {
  const router = useRouter()
  const [linkedAccounts, setLinkedAccounts] = useState(initialAccounts)
  const [banner, setBanner] = useState(initialBanner)
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const isGoogleLinked = linkedAccounts.some((acc) => acc.provider === 'google')
  const isStaff = user.role === 'admin' || user.role === 'editor'

  const handleUnlinkGoogle = async () => {
    if (!confirm('Are you sure you want to unlink your Google account?')) {
      return
    }

    setIsUnlinking(true)
    setBanner(null)

    try {
      const response = await fetch('/api/auth/google/unlink', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to unlink Google account.')
      }

      setLinkedAccounts((prev) => prev.filter((acc) => acc.provider !== 'google'))
      setBanner({
        type: 'success',
        message: 'Google account has been unlinked.',
      })
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to unlink account.',
      })
    } finally {
      setIsUnlinking(false)
    }
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/login')
      router.refresh()
    } catch {
      router.push('/login')
    }
  }

  return (
    <div className="space-y-6">
      {/* Banner notices */}
      {banner && (
        <div
          role="alert"
          className={`rounded-xl border p-4 text-sm ${
            banner.type === 'success'
              ? 'border-success/30 bg-success-subtle text-success'
              : banner.type === 'info'
                ? 'border-info/30 bg-info-subtle text-info'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {banner.message}
        </div>
      )}

      {/* Profile Overview */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Account Profile</CardTitle>
              <CardDescription>
                Your Menfesawi account credentials and settings
              </CardDescription>
            </div>
            {isStaff && (
              <Link href="/admin">
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary-hover"
                >
                  Enter Admin Portal
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {user.avatarURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarURL}
                alt={user.name || user.email}
                className="size-16 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-semibold text-xl">
                {(user.name || user.email).charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {user.name || 'Menfesawi Reader'}
              </h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Role
              </span>
              <p className="text-sm font-medium capitalize text-foreground">
                {user.role}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Status
              </span>
              <p className="text-sm font-medium text-success">
                {user.isActive ? 'Active' : 'Inactive'}
              </p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="border-t border-border pt-4 flex justify-between">
          <span className="text-xs text-muted-foreground">
            Password login:{' '}
            {user.hasPassword ? 'Enabled' : 'Not set (Google OAuth only)'}
          </span>
          <Button
            variant="ghost"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="text-destructive hover:bg-destructive/10"
          >
            {isLoggingOut ? 'Logging out...' : 'Sign Out'}
          </Button>
        </CardFooter>
      </Card>

      {/* Linked Accounts */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Connected Accounts</CardTitle>
          <CardDescription>
            Manage external identity providers connected to your Menfesawi account
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-foreground">Google</p>
                <p className="text-xs text-muted-foreground">
                  {isGoogleLinked
                    ? 'Connected for one-click sign-in'
                    : 'Not connected'}
                </p>
              </div>
            </div>

            <div>
              {isGoogleLinked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUnlinkGoogle}
                  disabled={isUnlinking}
                  className="text-destructive hover:bg-destructive/10"
                >
                  {isUnlinking ? 'Unlinking...' : 'Disconnect'}
                </Button>
              ) : (
                <a href="/api/auth/google?action=link&redirect=/account">
                  <Button
                    size="sm"
                    className="bg-primary text-primary-foreground hover:bg-primary-hover"
                  >
                    Connect
                  </Button>
                </a>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
