import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface ReceiptStorage {
  /** PUT URL that only accepts the declared content type and length. */
  presignUpload(key: string, mimeType: string, sizeBytes: number, expiresInSeconds: number): Promise<string>
  /** Size and content type of the stored object, or null if it does not exist. */
  statObject(key: string): Promise<{ sizeBytes: number; mimeType: string } | null>
  /** The stored bytes. The 10 MB upload cap bounds the size, so the whole object is held in memory. */
  getObject(key: string): Promise<Uint8Array>
}

const REQUIRED_VARIABLES = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
] as const

// Only the variable name goes into the error: the values include a secret.
function readStorageConfig(env: Record<string, string | undefined>) {
  for (const name of REQUIRED_VARIABLES) {
    if (!env[name]) throw new Error(`Receipt storage is not configured: ${name} is missing`)
  }
  return {
    endpoint: env.STORAGE_ENDPOINT as string,
    region: env.STORAGE_REGION as string,
    bucket: env.STORAGE_BUCKET as string,
    accessKeyId: env.STORAGE_ACCESS_KEY as string,
    secretAccessKey: env.STORAGE_SECRET_KEY as string,
  }
}

export function createReceiptStorage(env: Record<string, string | undefined> = process.env): ReceiptStorage {
  const config = readStorageConfig(env)
  // Path-style addressing is required by MinIO; R2 and S3 accept it too.
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })

  return {
    presignUpload(key, mimeType, sizeBytes, expiresInSeconds) {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      })
      return getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['content-type', 'content-length']),
      })
    },
    async getObject(key) {
      const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      if (!object.Body) throw new Error('Receipt object has no body')
      return object.Body.transformToByteArray()
    },
    async statObject(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
        return { sizeBytes: head.ContentLength ?? 0, mimeType: head.ContentType ?? '' }
      } catch (error) {
        if ((error as { name?: string }).name === 'NotFound') return null
        throw error
      }
    },
  }
}
