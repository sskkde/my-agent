import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDingTalkAdapter } from '../../../src/connectors/messaging/providers/dingtalk.js'
import { createFeishuAdapter } from '../../../src/connectors/messaging/providers/feishu.js'
import type { MessagingTransport } from '../../../src/connectors/messaging/types.js'

const transport: MessagingTransport = {
  sendText: async () => ({ success: true }),
  verifyWebhook: async () => true,
}

function dingtalkSignature(timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
}

describe('messaging provider inbound verification', () => {
  it('rejects DingTalk inbound callbacks when signSecret is missing', async () => {
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot' },
      transport,
    )

    await expect(adapter.verifyInbound({}, {})).resolves.toBe(false)
  })

  it('accepts DingTalk inbound callbacks with a valid signature', async () => {
    const signSecret = 'secret-123'
    const timestamp = String(Date.now())
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot', signSecret },
      transport,
    )

    await expect(
      adapter.verifyInbound({}, { timestamp, sign: dingtalkSignature(timestamp, signSecret) }),
    ).resolves.toBe(true)
  })

  it('rejects DingTalk inbound callbacks with an invalid signature', async () => {
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot', signSecret: 'secret-123' },
      transport,
    )

    await expect(adapter.verifyInbound({}, { timestamp: String(Date.now()), sign: 'bad-signature' })).resolves.toBe(false)
  })

  it('rejects Feishu callbacks when encryptKey is configured because encrypted payloads are unsupported', async () => {
    const adapter = createFeishuAdapter(
      { appId: 'app-id', appSecret: 'app-secret', verificationToken: 'verify-token', encryptKey: 'encrypt-key' },
      transport,
    )
    const payload = {
      schema: '2.0',
      header: { token: 'verify-token' },
      event: { message: { message_type: 'text' } },
    }

    await expect(adapter.verifyInbound(payload, { 'x-lark-signature': 'present' })).resolves.toBe(false)
  })
})
