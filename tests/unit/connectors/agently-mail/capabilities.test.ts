/**
 * Tests for AgentlyMail connector capabilities.
 * Validates capability IDs, categories, risk levels, and auth requirements.
 */

import { describe, it, expect } from 'vitest'
import {
  createAgentlyMailCapabilities,
  AGENTLY_MAIL_EXPOSED_OPERATIONS,
  AGENTLY_MAIL_HIDDEN_OPERATIONS,
  getCapabilityByOperation,
} from '../../../../src/connectors/agently-mail/capabilities.js'
import type { ConnectorCapability } from '../../../../src/connectors/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function caps(): ConnectorCapability[] {
  return createAgentlyMailCapabilities()
}

function capById(id: string): ConnectorCapability {
  const found = caps().find((c) => c.capabilityId === id)
  expect(found, `capability ${id} not found`).toBeDefined()
  return found!
}

// ─── Snapshot: all capability IDs ─────────────────────────────────────────────

describe('createAgentlyMailCapabilities', () => {
  it('returns exactly 10 capabilities for exposed operations', () => {
    expect(caps()).toHaveLength(10)
  })

  it('matches snapshot of all capabilityIds', () => {
    const ids = caps().map((c) => c.capabilityId).sort()
    expect(ids).toMatchInlineSnapshot(`
      [
        "agently_mail.auth_status",
        "agently_mail.download_attachment",
        "agently_mail.forward_message",
        "agently_mail.list_messages",
        "agently_mail.me",
        "agently_mail.read_message",
        "agently_mail.reply_message",
        "agently_mail.search_messages",
        "agently_mail.send_message",
        "agently_mail.trash_message",
      ]
    `)
  })

  it('matches snapshot of all categories', () => {
    const cats = caps().map((c) => `${c.capabilityId}:${c.category}`).sort()
    expect(cats).toMatchInlineSnapshot(`
      [
        "agently_mail.auth_status:read",
        "agently_mail.download_attachment:read",
        "agently_mail.forward_message:send",
        "agently_mail.list_messages:read",
        "agently_mail.me:read",
        "agently_mail.read_message:read",
        "agently_mail.reply_message:send",
        "agently_mail.search_messages:search",
        "agently_mail.send_message:send",
        "agently_mail.trash_message:delete",
      ]
    `)
  })

  it('matches snapshot of all risk levels', () => {
    const risks = caps().map((c) => `${c.capabilityId}:${c.riskLevel}`).sort()
    expect(risks).toMatchInlineSnapshot(`
      [
        "agently_mail.auth_status:low",
        "agently_mail.download_attachment:low",
        "agently_mail.forward_message:medium",
        "agently_mail.list_messages:low",
        "agently_mail.me:low",
        "agently_mail.read_message:low",
        "agently_mail.reply_message:medium",
        "agently_mail.search_messages:low",
        "agently_mail.send_message:medium",
        "agently_mail.trash_message:high",
      ]
    `)
  })

  it('all capabilities require auth', () => {
    for (const cap of caps()) {
      expect(cap.requiresAuth).toBe(true)
    }
  })
})

// ─── Risk level assertions ────────────────────────────────────────────────────

describe('risk levels', () => {
  it('read operations have riskLevel=low', () => {
    for (const id of [
      'agently_mail.me',
      'agently_mail.auth_status',
      'agently_mail.list_messages',
      'agently_mail.read_message',
      'agently_mail.download_attachment',
    ]) {
      expect(capById(id).riskLevel).toBe('low')
    }
  })

  it('search_messages has riskLevel=low', () => {
    expect(capById('agently_mail.search_messages').riskLevel).toBe('low')
  })

  it('write/send operations have riskLevel=medium', () => {
    for (const id of [
      'agently_mail.send_message',
      'agently_mail.reply_message',
      'agently_mail.forward_message',
    ]) {
      expect(capById(id).riskLevel).toBe('medium')
    }
  })

  it('trash_message has riskLevel=high and category=delete', () => {
    const trash = capById('agently_mail.trash_message')
    expect(trash.riskLevel).toBe('high')
    expect(trash.category).toBe('delete')
  })
})

// ─── Auth exclusion ───────────────────────────────────────────────────────────

describe('auth operations exclusion', () => {
  it('does not expose auth_login as a capability', () => {
    const ids = caps().map((c) => c.capabilityId)
    expect(ids).not.toContain('agently_mail.auth_login')
    expect(ids).not.toContain(expect.stringContaining('auth_login'))
  })

  it('does not expose auth_logout as a capability', () => {
    const ids = caps().map((c) => c.capabilityId)
    expect(ids).not.toContain('agently_mail.auth_logout')
    expect(ids).not.toContain(expect.stringContaining('auth_logout'))
  })

  it('AGENTLY_MAIL_HIDDEN_OPERATIONS lists auth_login and auth_logout', () => {
    expect(AGENTLY_MAIL_HIDDEN_OPERATIONS).toEqual(['auth_login', 'auth_logout'])
  })

  it('AGENTLY_MAIL_EXPOSED_OPERATIONS excludes auth_login and auth_logout', () => {
    expect(AGENTLY_MAIL_EXPOSED_OPERATIONS).not.toContain('auth_login')
    expect(AGENTLY_MAIL_EXPOSED_OPERATIONS).not.toContain('auth_logout')
  })

  it('getCapabilityByOperation returns undefined for auth_login', () => {
    expect(getCapabilityByOperation('auth_login')).toBeUndefined()
  })

  it('getCapabilityByOperation returns undefined for auth_logout', () => {
    expect(getCapabilityByOperation('auth_logout')).toBeUndefined()
  })
})

// ─── Input schema shape ───────────────────────────────────────────────────────

describe('input schemas', () => {
  it('no-param capabilities have empty properties', () => {
    for (const id of ['agently_mail.me', 'agently_mail.auth_status']) {
      const schema = capById(id).inputSchema
      expect(schema).toEqual({ type: 'object', properties: {}, required: [] })
    }
  })

  it('read_message requires id', () => {
    const schema = capById('agently_mail.read_message').inputSchema
    expect(schema.required).toEqual(['id'])
  })

  it('search_messages requires q', () => {
    const schema = capById('agently_mail.search_messages').inputSchema
    expect(schema.required).toEqual(['q'])
  })

  it('send_message requires to, subject, body', () => {
    const schema = capById('agently_mail.send_message').inputSchema
    expect(schema.required).toEqual(['to', 'subject', 'body'])
  })

  it('reply_message requires id, body', () => {
    const schema = capById('agently_mail.reply_message').inputSchema
    expect(schema.required).toEqual(['id', 'body'])
  })

  it('forward_message requires id, to', () => {
    const schema = capById('agently_mail.forward_message').inputSchema
    expect(schema.required).toEqual(['id', 'to'])
  })

  it('trash_message requires id', () => {
    const schema = capById('agently_mail.trash_message').inputSchema
    expect(schema.required).toEqual(['id'])
  })

  it('download_attachment requires msg, att', () => {
    const schema = capById('agently_mail.download_attachment').inputSchema
    expect(schema.required).toEqual(['msg', 'att'])
  })
})

// ─── Structural integrity ─────────────────────────────────────────────────────

describe('structural integrity', () => {
  it('every capability has a single-element supportedOperations', () => {
    for (const cap of caps()) {
      expect(cap.supportedOperations).toHaveLength(1)
    }
  })

  it('capabilityId follows agently_mail.<operation> pattern', () => {
    for (const cap of caps()) {
      expect(cap.capabilityId).toMatch(/^agently_mail\.\w+$/)
    }
  })

  it('supportedOperations[0] matches the suffix of capabilityId', () => {
    for (const cap of caps()) {
      const suffix = cap.capabilityId.replace('agently_mail.', '')
      expect(cap.supportedOperations[0]).toBe(suffix)
    }
  })
})
