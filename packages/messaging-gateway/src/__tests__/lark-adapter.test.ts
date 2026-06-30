/**
 * LarkAdapter tests — focused on pure / unit-testable surface.
 *
 * The full adapter relies on Lark's WSClient (long-polling socket) and a
 * concrete `Client` instance, neither of which can be exercised in a unit
 * test without integration infrastructure. These tests cover the credential
 * parser and confirm the adapter's static contract (capabilities, platform).
 *
 * End-to-end behaviour (event dispatch, send/edit roundtrips) is verified
 * via manual smoke against a real Lark Custom App.
 */
import { describe, expect, it } from 'bun:test'
import { parseLarkCredentials, LarkAdapter } from '../adapters/lark/index'

describe('parseLarkCredentials', () => {
  it('parses a valid JSON-encoded credential blob', () => {
    const creds = parseLarkCredentials(
      JSON.stringify({ appId: 'cli_abc', appSecret: 'secret', domain: 'lark' }),
    )
    expect(creds.appId).toBe('cli_abc')
    expect(creds.appSecret).toBe('secret')
    expect(creds.domain).toBe('lark')
  })

  it('accepts feishu domain', () => {
    const creds = parseLarkCredentials(
      JSON.stringify({ appId: 'cli_abc', appSecret: 'x', domain: 'feishu' }),
    )
    expect(creds.domain).toBe('feishu')
  })

  it('throws on missing token', () => {
    expect(() => parseLarkCredentials(undefined)).toThrow(/missing/i)
    expect(() => parseLarkCredentials('')).toThrow(/missing/i)
  })

  it('throws on non-JSON input', () => {
    expect(() => parseLarkCredentials('not-json')).toThrow(/JSON/i)
  })

  it('throws on missing appId or appSecret', () => {
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appSecret: 'x', domain: 'lark' })),
    ).toThrow(/appId/i)
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appId: 'cli_x', domain: 'lark' })),
    ).toThrow(/appSecret/i)
  })

  it('throws on invalid domain', () => {
    expect(() =>
      parseLarkCredentials(JSON.stringify({ appId: 'cli_x', appSecret: 'x', domain: 'larksuite' })),
    ).toThrow(/domain/i)
  })
})

describe('LarkAdapter — static contract', () => {
  it('declares platform = "lark"', () => {
    const adapter = new LarkAdapter()
    expect(adapter.platform).toBe('lark')
  })

  it('reports Phase 2 capabilities (edits, buttons, lark-post)', () => {
    const adapter = new LarkAdapter()
    expect(adapter.capabilities.messageEditing).toBe(true)
    expect(adapter.capabilities.inlineButtons).toBe(true)
    expect(adapter.capabilities.markdown).toBe('lark-post')
    expect(adapter.capabilities.maxButtons).toBe(10)
    expect(adapter.capabilities.webhookSupport).toBe(false)
  })

  it('starts disconnected before initialize', () => {
    const adapter = new LarkAdapter()
    expect(adapter.isConnected()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Event handling — dedup, bot-filter, emoji ack, inbound reactions.
//
// These reach into the adapter's private methods with a fake `client` +
// `messageHandler` injected, since the real handlers are wired through the
// WSClient inside initialize(), which needs live integration infra.
// ---------------------------------------------------------------------------

interface FakeCalls {
  reactions: Array<{ path: { message_id: string }; data: { reaction_type: { emoji_type: string } } }>
  gets: string[]
}

function makeAdapterWithFakeClient() {
  const adapter = new LarkAdapter()
  const calls: FakeCalls = { reactions: [], gets: [] }
  const fakeClient = {
    im: {
      message: {
        get: async ({ path }: { path: { message_id: string } }) => {
          calls.gets.push(path.message_id)
          return { data: { items: [{ chat_id: 'oc_resolved' }] } }
        },
      },
      messageReaction: {
        create: async (args: FakeCalls['reactions'][number]) => {
          calls.reactions.push(args)
          return { data: { reaction_id: 'r1' } }
        },
        delete: async () => ({}),
      },
    },
  }
  const received: Array<Record<string, unknown>> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(adapter as any).client = fakeClient
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(adapter as any).messageHandler = async (m: Record<string, unknown>) => {
    received.push(m)
  }
  return { adapter, calls, received }
}

function textEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'evt-default',
    sender: { sender_id: { open_id: 'ou_user' }, sender_type: 'user' },
    message: {
      message_id: 'om_1',
      chat_id: 'oc_1',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      create_time: '1700000000',
    },
    ...overrides,
  }
}

describe('LarkAdapter — event dedup (isDuplicateEvent)', () => {
  it('treats a repeated event_id within TTL as a duplicate', () => {
    const { adapter } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = (id?: string, fb?: string) => (adapter as any).isDuplicateEvent(id, fb)
    expect(dup('e1', 'm1')).toBe(false)
    expect(dup('e1', 'm1')).toBe(true)
    expect(dup('e2', 'm2')).toBe(false)
  })

  it('falls back to the message_id key when event_id is absent', () => {
    const { adapter } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = (id?: string, fb?: string) => (adapter as any).isDuplicateEvent(id, fb)
    expect(dup(undefined, 'mX')).toBe(false)
    expect(dup(undefined, 'mX')).toBe(true)
  })
})

describe('LarkAdapter — inbound message handling', () => {
  it('routes a user text message, flags no bot, and adds the emoji ack', async () => {
    const { adapter, calls, received } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleIncomingMessage(textEvent())
    expect(received).toHaveLength(1)
    expect(received[0]!.text).toBe('hello')
    expect(received[0]!.senderIsBot).toBeUndefined()
    expect(calls.reactions).toHaveLength(1)
    expect(calls.reactions[0]!.path.message_id).toBe('om_1')
    expect(calls.reactions[0]!.data.reaction_type.emoji_type).toBe('StatusFlashOfInspiration')
  })

  it('flags app-sender messages as bot and skips the ack reaction', async () => {
    const { adapter, calls, received } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleIncomingMessage(
      textEvent({ sender: { sender_id: { open_id: 'ou_bot' }, sender_type: 'app' } }),
    )
    expect(received).toHaveLength(1)
    expect(received[0]!.senderIsBot).toBe(true)
    expect(calls.reactions).toHaveLength(0)
  })
})

describe('LarkAdapter — inbound reaction handling', () => {
  it('surfaces a user reaction as a synthetic message with the emoji + resolved chat', async () => {
    const { adapter, calls, received } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleReaction({
      event_id: 'er1',
      message_id: 'om_1',
      reaction_type: { emoji_type: 'SMILE' },
      operator_type: 'user',
      user_id: { open_id: 'ou_user' },
      action_time: '1700000001',
    })
    expect(calls.gets).toContain('om_1')
    expect(received).toHaveLength(1)
    expect(received[0]!.channelId).toBe('oc_resolved')
    expect(String(received[0]!.text)).toContain(':SMILE:')
  })

  it('ignores our own ack reactions (operator_type "app") to avoid an echo loop', async () => {
    const { adapter, received } = makeAdapterWithFakeClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adapter as any).handleReaction({
      event_id: 'er2',
      message_id: 'om_1',
      reaction_type: { emoji_type: 'StatusFlashOfInspiration' },
      operator_type: 'app',
    })
    expect(received).toHaveLength(0)
  })
})
