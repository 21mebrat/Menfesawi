'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginFormProps {
  redirectTarget: string
}

export default function LoginForm({ redirectTarget }: LoginFormProps) {
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setIsLoading(true)

    try {
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login'
      const payload =
        mode === 'signup'
          ? { name, email, password }
          : { email, password }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || (mode === 'signup' ? 'Failed to create account.' : 'Failed to sign in.'))
      }

      // Successful login or registration
      router.push(redirectTarget)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-center text-xs font-medium">
        <button
          type="button"
          onClick={() => {
            setMode('signin')
            setError(null)
          }}
          className={`rounded-md py-1.5 transition-all ${
            mode === 'signin'
              ? 'bg-card text-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Sign In
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup')
            setError(null)
          }}
          className={`rounded-md py-1.5 transition-all ${
            mode === 'signup'
              ? 'bg-card text-foreground shadow-xs font-semibold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {mode === 'signup' && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              type="text"
              placeholder="e.g. Abebe Bikila"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isLoading}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {mode === 'signup' && (
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-primary text-primary-foreground hover:bg-primary-hover"
          disabled={isLoading}
        >
          {isLoading
            ? mode === 'signup'
              ? 'Creating account...'
              : 'Signing in...'
            : mode === 'signup'
              ? 'Create Account with Email'
              : 'Sign In with Email'}
        </Button>
      </form>
    </div>
  )
}
