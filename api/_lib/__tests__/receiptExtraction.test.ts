import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractReceipt,
  type ExtractionDeps,
  type ExtractionOutcome,
  type ModelClient,
  type ReadyReceipt,
} from '../receiptExtraction'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222'
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333'
const API_KEY = 'sk-ant-test-key-do-not-log'
const SECRET_VENDOR = 'Invented Cafe Ltd'

const goodReply = {
  date: { value: '2026-10-30', confidence: 0.95 },
  vendor: { value: SECRET_VENDOR, confidence: 0.9 },
  totalPence: { value: 2399, confidence: 0.99 },
  vatPence: null,
  category: { value: 'meals', confidence: 0.6 },
  currency: 'GBP',
  confidence: 0.87,
  notes: null,
}

const receipt = (mimeType: ReadyReceipt['mimeType'] = 'image/png'): ReadyReceipt => ({ id: RECEIPT_ID, fileKey: `${OWNER}/file`, mimeType })

function setup(options: { reply?: string | Error; mimeType?: ReadyReceipt['mimeType']; env?: Record<string, string | undefined> } = {}) {
  const saved: { userId: string; receiptId: string; outcome: ExtractionOutcome }[] = []
  const findReady = vi.fn(async (userId: string, id: string) => (userId === OWNER && id === RECEIPT_ID ? receipt(options.mimeType) : undefined))
  const create = vi.fn(async (_params: Parameters<ModelClient['messages']['create']>[0]) => {
    if (options.reply instanceof Error) throw options.reply
    return { content: [{ type: 'text' as const, text: options.reply ?? JSON.stringify(goodReply) }] }
  })
  const getObject = vi.fn(async () => new Uint8Array([1, 2, 3]))
  const deps: ExtractionDeps = {
    store: { findReady, save: async (userId, receiptId, outcome) => void saved.push({ userId, receiptId, outcome }) },
    storage: { getObject },
    client: { messages: { create } },
    now: () => new Date('2026-11-02T10:00:00Z'),
    env: { ANTHROPIC_API_KEY: API_KEY, ...options.env },
  }
  return { deps, saved, findReady, create, getObject }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('extractReceipt', () => {
  it('stores a good reply as one draft row per field with thousandths confidence', async () => {
    const { deps, saved } = setup()
    const result = await extractReceipt(deps, OWNER, RECEIPT_ID)
    expect(result).toEqual({ status: 'extracted' })
    expect(saved).toHaveLength(1)
    const { outcome } = saved[0]
    expect(outcome.aiStatus).toBe('extracted')
    expect(outcome.aiModel).toBe('claude-haiku-4-5-20251001')
    expect(outcome.aiConfidence).toBe(870)
    expect(outcome.rawOutput).toEqual({ reply: JSON.stringify(goodReply) })
    expect(outcome.extractions).toEqual([
      { field: 'date', suggestedValue: '2026-10-30', confidence: 950 },
      { field: 'vendor', suggestedValue: SECRET_VENDOR, confidence: 900 },
      { field: 'totalPence', suggestedValue: '2399', confidence: 990 },
      { field: 'category', suggestedValue: 'meals', confidence: 600 },
    ])
    expect(outcome.audit).toEqual({ action: 'receipt.extract', metadata: { status: 'extracted', fieldCount: 4 } })
  })

  it('uses the model id from RECEIPT_AI_MODEL and tells the model today\'s date', async () => {
    const { deps, create } = setup({ env: { RECEIPT_AI_MODEL: 'claude-test-model' } })
    await extractReceipt(deps, OWNER, RECEIPT_ID)
    const params = create.mock.calls[0][0]
    expect(params.model).toBe('claude-test-model')
    expect(params.system).toContain('2026-11-02')
  })

  it('sends images as image blocks', async () => {
    const { deps, create } = setup({ mimeType: 'image/png' })
    await extractReceipt(deps, OWNER, RECEIPT_ID)
    const block = create.mock.calls[0][0].messages[0].content[0]
    expect(block).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } })
  })

  it('sends PDFs as document blocks', async () => {
    const { deps, create } = setup({ mimeType: 'application/pdf' })
    await extractReceipt(deps, OWNER, RECEIPT_ID)
    const block = create.mock.calls[0][0].messages[0].content[0]
    expect(block).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AQID' } })
  })

  it.each([
    ['malformed JSON', 'this is not json {'],
    ['decimal amounts instead of pence', JSON.stringify({ ...goodReply, totalPence: { value: 23.99, confidence: 0.9 } })],
    ['a not-a-receipt reply', JSON.stringify({ error: 'not_a_receipt' })],
  ])('marks %s as failed with no extraction rows', async (_name, reply) => {
    const { deps, saved } = setup({ reply })
    const result = await extractReceipt(deps, OWNER, RECEIPT_ID)
    expect(result).toEqual({ status: 'failed' })
    expect(saved[0].outcome.aiStatus).toBe('failed')
    expect(saved[0].outcome.extractions).toEqual([])
    expect(saved[0].outcome.audit.metadata).toMatchObject({ status: 'failed' })
  })

  it('marks an API error as failed and logs only the receipt id and error class', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, saved } = setup({ reply: new TypeError(`bad request with ${API_KEY} and ${SECRET_VENDOR}`) })
    await extractReceipt(deps, OWNER, RECEIPT_ID)
    expect(saved[0].outcome.aiStatus).toBe('failed')
    expect(saved[0].outcome.extractions).toEqual([])
    expect(JSON.stringify(error.mock.calls)).toContain(RECEIPT_ID)
    expect(JSON.stringify(error.mock.calls)).toContain('TypeError')
  })

  it('never logs receipt content or the API key', async () => {
    const spies = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'info')].map((spy) => spy.mockImplementation(() => {}))
    for (const reply of [undefined, 'not json ' + SECRET_VENDOR, new Error(`${API_KEY} ${SECRET_VENDOR}`)]) {
      const { deps } = setup({ reply })
      await extractReceipt(deps, OWNER, RECEIPT_ID)
    }
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls))
    expect(logged).not.toContain(API_KEY)
    expect(logged).not.toContain(SECRET_VENDOR)
  })

  it('skips without calling storage or the model when the key is missing', async () => {
    const { deps, saved, create, getObject } = setup({ env: { ANTHROPIC_API_KEY: undefined } })
    expect(await extractReceipt(deps, OWNER, RECEIPT_ID)).toEqual({ status: 'skipped' })
    expect(saved[0].outcome.aiStatus).toBe('skipped')
    expect(saved[0].outcome.extractions).toEqual([])
    expect(create).not.toHaveBeenCalled()
    expect(getObject).not.toHaveBeenCalled()
  })

  it('skips without calling the model when the kill switch is off', async () => {
    const { deps, saved, create } = setup({ env: { RECEIPT_AI_ENABLED: 'false' } })
    expect(await extractReceipt(deps, OWNER, RECEIPT_ID)).toEqual({ status: 'skipped' })
    expect(saved[0].outcome.aiStatus).toBe('skipped')
    expect(create).not.toHaveBeenCalled()
  })

  it('returns not found for another owner\'s receipt and writes nothing', async () => {
    const { deps, saved, create, findReady } = setup()
    expect(await extractReceipt(deps, OTHER_OWNER, RECEIPT_ID)).toEqual({ status: 'not_found' })
    expect(findReady).toHaveBeenCalledWith(OTHER_OWNER, RECEIPT_ID)
    expect(saved).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })
})
