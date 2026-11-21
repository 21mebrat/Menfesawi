import {
    APIError,
    type CollectionAfterChangeHook,
} from 'payload'

type Destination =
    | 'telegram-channel'
    | 'telegram-group'
    | 'facebook'
    | 'instagram'

const supportedDestinations: Destination[] = [
    'telegram-channel',
    'telegram-group',
    'facebook',
    'instagram',
]

function isDestination(value: string): value is Destination {
    return supportedDestinations.some(
        (destination) => destination === value,
    )
}
type PublishingSettings = {
    language: 'am' | 'en'
    destinations: Destination[]
}

function getPublishingSettings(): PublishingSettings | null {
    const enabled = process.env.SOCIAL_AUTO_PUBLISH === 'true'

    if (!enabled) {
        return null
    }

    const language = process.env.SOCIAL_PUBLISH_LANGUAGE ?? 'am';

    if (language !== 'am' && language !== 'en') {
        throw new APIError(
            'SOCIAL_PUBLISH_LANGUAGE must be am or en.',
            500,
        )
    }

    const configuredDestinations = (
        process.env.SOCIAL_PUBLISH_DESTINATIONS ?? ''
    )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)

    if (configuredDestinations.length === 0) {
        throw new APIError(
            'Configure SOCIAL_PUBLISH_DESTINATIONS before enabling automatic publishing.',
            500,
        )
    }

    const destinations: Destination[] = []

    for (const value of configuredDestinations) {
        if (!isDestination(value)) {
            throw new APIError(
                'SOCIAL_PUBLISH_DESTINATIONS contains an unsupported destination.',
                500,
            )
        }

        if (!destinations.includes(value)) {
            destinations.push(value)
        }
    }

    return {
        language,
        destinations,
    }
}

export const queueTeachingAnnouncements: CollectionAfterChangeHook =
    async ({ doc, previousDoc, req }) => {
        // Draft saves never create announcements.
        if (doc._status !== 'published') {
            return doc
        }

        // Ordinary edits to a published teaching do not announce it again.
        if (previousDoc?._status === 'published') {
            return doc
        }

        const settings = getPublishingSettings()

        if (!settings) {
            return doc
        }

        for (const destination of settings.destinations) {
            /**
             * One first-publication announcement per teaching/destination.
             *
             * Re-publishing the same teaching must not automatically create
             * another announcement.
             */
            const deliveryKey =
                `teaching:${String(doc.id)}:first-publication:${destination}`

            const existing = await req.payload.find({
                collection: 'social-deliveries',
                req,
                overrideAccess: true,
                depth: 0,
                limit: 1,
                pagination: false,

                where: {
                    deliveryKey: {
                        equals: deliveryKey,
                    },
                },
            })

            if (existing.docs.length > 0) {
                continue
            }

            await req.payload.create({
                collection: 'social-deliveries',
                req,
                overrideAccess: true,
                depth: 0,

                data: {
                    deliveryKey,
                    teaching: doc.id,
                    destination,
                    language: settings.language,
                    status: 'pending',
                    attempts: 0,
                },
            })
        }

        return doc
    }