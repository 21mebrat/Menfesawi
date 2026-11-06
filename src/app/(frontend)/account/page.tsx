import React from 'react'
import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import configPromise from '@/payload.config'
import AccountView from './account-view'

interface AccountPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const NOTICES: Record<string, { type: 'success' | 'info' | 'error'; message: string }> = {
  google_linked: {
    type: 'success',
    message: 'Your Google account has been successfully linked.',
  },
  already_linked: {
    type: 'info',
    message: 'This Google account is already linked to your profile.',
  },
  account_already_linked_different_user: {
    type: 'error',
    message:
      'This Google account is already linked to a different Menfesawi account.',
  },
  linking_failed: {
    type: 'error',
    message: 'Failed to link Google account. Please try again.',
  },
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const headers = await getHeaders()
  const config = await configPromise
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers })

  if (!user) {
    redirect('/login?redirect=/account')
  }

  // Fetch full user record to inspect role, avatar, and password status
  const fullUser = await payload.findByID({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    showHiddenFields: true,
  })

  // Fetch linked provider accounts for this user
  const authAccountsResult = await payload.find({
    collection: 'auth-accounts',
    where: {
      user: {
        equals: user.id,
      },
    },
    overrideAccess: true,
  })

  const resolvedParams = await searchParams
  let banner: { type: 'success' | 'info' | 'error'; message: string } | null = null

  if (typeof resolvedParams.success === 'string' && NOTICES[resolvedParams.success]) {
    banner = NOTICES[resolvedParams.success]
  } else if (typeof resolvedParams.info === 'string' && NOTICES[resolvedParams.info]) {
    banner = NOTICES[resolvedParams.info]
  } else if (typeof resolvedParams.error === 'string') {
    banner = NOTICES[resolvedParams.error] || {
      type: 'error',
      message: decodeURIComponent(resolvedParams.error),
    }
  }

  const linkedAccounts = authAccountsResult.docs.map((acc) => ({
    id: String(acc.id),
    provider: acc.provider,
    providerAccountId: acc.providerAccountId,
    createdAt: acc.createdAt,
  }))

  const hasPassword = Boolean((fullUser as any).hash)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <AccountView
        user={{
          id: String(fullUser.id),
          email: fullUser.email,
          name: (fullUser as any).name || '',
          role: (fullUser as any).role || 'member',
          avatarURL: (fullUser as any).avatarURL || '',
          isActive: (fullUser as any).isActive !== false,
          hasPassword,
        }}
        linkedAccounts={linkedAccounts}
        banner={banner}
      />
    </div>
  )
}
