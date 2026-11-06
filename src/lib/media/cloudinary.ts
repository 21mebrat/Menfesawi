import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'
import type { Adapter } from '@payloadcms/plugin-cloud-storage/types'
import fs from 'fs'

const PLACEHOLDERS = new Set([
  '',
  'your_cloud_name_here',
  'your_api_key_here',
  'your_api_secret_here',
  'your-cloud-name',
  'your-api-key',
  'your-api-secret',
  'placeholder',
])

/**
 * Checks whether Cloudinary credentials are validly configured in the environment
 * and not set to default placeholder strings.
 */
export function isCloudinaryConfigured(): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim().toLowerCase()
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim().toLowerCase()
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim().toLowerCase()

  if (!cloudName || !apiKey || !apiSecret) {
    return false
  }

  if (
    PLACEHOLDERS.has(cloudName) ||
    PLACEHOLDERS.has(apiKey) ||
    PLACEHOLDERS.has(apiSecret)
  ) {
    return false
  }

  return true
}

/**
 * Returns a configured Cloudinary v2 SDK instance if credentials are valid,
 * or null if credentials are placeholder/missing.
 */
export function getCloudinaryClient() {
  if (!isCloudinaryConfigured()) {
    return null
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: process.env.CLOUDINARY_API_KEY?.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET?.trim(),
    secure: true,
  })

  return cloudinary
}

export interface CloudinaryAdapterOptions {
  folder?: string
}

/**
 * Creates a Payload CMS storage adapter for Cloudinary.
 * Integrates with @payloadcms/plugin-cloud-storage.
 */
export const createCloudinaryStorageAdapter = (
  options: CloudinaryAdapterOptions = {},
): Adapter => {
  const folder =
    options.folder || process.env.CLOUDINARY_FOLDER?.trim() || 'ethiopia-travel-journal'

  return () => {
    return {
      name: 'cloudinary',

      handleUpload: async ({ file, req }) => {
        const client = getCloudinaryClient()
        if (!client) {
          req.payload.logger.warn(
            '[Cloudinary] Upload called but Cloudinary is not configured with active credentials.',
          )
          return {}
        }

        const baseFilename = (file.filename || 'upload')
          .replace(/\.[^/.]+$/, '')
          .replace(/[^a-zA-Z0-9_-]/g, '_')
        const publicId = `${folder}/${baseFilename}_${Date.now()}`

        const uploadStream = (buffer: Buffer): Promise<UploadApiResponse> => {
          return new Promise((resolve, reject) => {
            const stream = client.uploader.upload_stream(
              {
                folder,
                public_id: publicId,
                resource_type: 'auto',
                overwrite: true,
                unique_filename: false,
                use_filename: true,
              },
              (error, result) => {
                if (error || !result) {
                  return reject(error || new Error('Cloudinary upload returned an empty response'))
                }
                resolve(result)
              },
            )

            if (file.tempFilePath) {
              fs.createReadStream(file.tempFilePath).on('error', reject).pipe(stream)
            } else {
              stream.end(buffer)
            }
          })
        }

        const result = await uploadStream(file.buffer)

        return {
          cloudinaryPublicId: result.public_id,
          cloudinaryUrl: result.secure_url,
          url: result.secure_url,
        }
      },

      handleDelete: async ({ doc, req }) => {
        const client = getCloudinaryClient()
        if (!client) return

        const publicId = (doc as any)?.cloudinaryPublicId
        if (publicId && typeof publicId === 'string') {
          try {
            await client.uploader.destroy(publicId, {
              invalidate: true,
              resource_type: 'image',
            })
          } catch (err) {
            req.payload.logger.error(`[Cloudinary] Failed to delete asset ${publicId}: ${err}`)
          }
        }
      },

      generateURL: ({ data, filename }) => {
        if (data?.cloudinaryUrl) {
          return data.cloudinaryUrl
        }
        if (data?.cloudinaryPublicId) {
          const client = getCloudinaryClient()
          if (client) {
            return client.url(data.cloudinaryPublicId, { secure: true })
          }
        }
        return `/api/media/file/${filename}`
      },

      staticHandler: async (req, { doc, params }) => {
        const { collection: collectionSlug, filename } = params

        let targetUrl: string | undefined = (doc as any)?.cloudinaryUrl

        if (!targetUrl) {
          const stored = await req.payload.find({
            collection: collectionSlug as any,
            where: { filename: { equals: filename } },
            limit: 1,
            pagination: false,
            overrideAccess: true,
          })
          const foundDoc = stored.docs[0] as any
          targetUrl = foundDoc?.cloudinaryUrl || foundDoc?.url
        }

        if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
          return Response.redirect(targetUrl, 307)
        }

        return new Response('File not found', { status: 404 })
      },
    }
  }
}
