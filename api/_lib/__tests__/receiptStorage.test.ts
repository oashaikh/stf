import { describe, expect, it } from 'vitest'
import { createReceiptStorage } from '../receiptStorage'

const FULL_ENV = {
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'stf-receipts',
  STORAGE_ACCESS_KEY: 'access-key-value-123',
  STORAGE_SECRET_KEY: 'secret-key-value-456',
}

describe('createReceiptStorage', () => {
  it.each(Object.keys(FULL_ENV))('names %s when it is missing', (name) => {
    const env: Record<string, string | undefined> = { ...FULL_ENV, [name]: undefined }
    expect(() => createReceiptStorage(env)).toThrow(name)
  })

  it('treats an empty variable as missing', () => {
    expect(() => createReceiptStorage({ ...FULL_ENV, STORAGE_BUCKET: '' })).toThrow('STORAGE_BUCKET')
  })

  it('never puts an env value in the error message', () => {
    let message = ''
    try {
      createReceiptStorage({ ...FULL_ENV, STORAGE_BUCKET: undefined })
    } catch (error) {
      message = (error as Error).message
    }
    for (const value of Object.values(FULL_ENV)) expect(message).not.toContain(value)
  })

  it('builds a client without connecting when config is complete', async () => {
    const storage = createReceiptStorage(FULL_ENV)
    const url = await storage.presignUpload('owner/abc', 'image/png', 1024, 300)
    expect(url).toContain('/stf-receipts/owner/abc')
  })
  it('presigns a short-lived read URL for the key', async () => {
    const storage = createReceiptStorage(FULL_ENV)
    const url = new URL(await storage.presignRead('owner/abc', 300))
    expect(url.pathname).toBe('/stf-receipts/owner/abc')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  })
})
