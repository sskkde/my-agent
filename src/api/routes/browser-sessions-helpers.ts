import type { Page } from 'playwright-core'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { BrowserSessionId, OwnershipState, FrameMeta } from '../../search/browser/browser-session-types.js'
import type { BrowserFrameStream } from '../../search/browser/browser-frame-stream.js'
import type { BrowserSessionManager } from '../../search/browser/browser-session-manager.js'
import type {
  BrowserSessionState,
  BrowserSnapshotEvent,
  BrowserHeartbeatEvent,
  BrowserFrameEvent,
} from './browser-sessions-types.js'
import type { BrowserInputEvent } from '../../search/browser/browser-session-types.js'

export function mapOwnershipToState(ownership: OwnershipState): BrowserSessionState {
  switch (ownership) {
    case 'agent_controlled':
    case 'resuming':
      return 'agent_controlled'
    case 'handoff_requested':
      return 'handoff_requested'
    case 'human_controlled':
      return 'user_controlled'
    case 'closed':
    case 'error':
      return 'idle'
  }
}

export function mapRouteInputToEvent(
  action: string,
  payload: Record<string, unknown>,
): BrowserInputEvent {
  switch (action) {
    case 'click':
      return {
        kind: 'click',
        x: payload.x as number,
        y: payload.y as number,
        button: (payload.button as 'left' | 'middle' | 'right') ?? 'left',
        clickCount: (payload.clickCount as number) ?? 1,
      }
    case 'keypress':
      return {
        kind: 'key',
        key: payload.key as string,
        modifiers: (payload.modifiers as string[]) ?? [],
      }
    case 'type':
      return { kind: 'text', text: payload.text as string }
    case 'scroll':
      return {
        kind: 'scroll',
        x: (payload.x as number) ?? 0,
        y: (payload.y as number) ?? 0,
        deltaX: payload.deltaX as number,
        deltaY: payload.deltaY as number,
      }
    default:
      throw new Error(`Unknown input action: ${action}`)
  }
}

export async function dispatchInputToPage(page: Page, event: BrowserInputEvent): Promise<void> {
  switch (event.kind) {
    case 'click':
      await page.mouse.click(event.x, event.y, { button: event.button, clickCount: event.clickCount })
      break
    case 'key':
      await page.keyboard.press(event.key)
      break
    case 'text':
      await page.keyboard.type(event.text)
      break
    case 'scroll':
      await page.mouse.wheel(event.deltaX, event.deltaY)
      break
  }
}

export function writeFrameSseStream(
  reply: FastifyReply,
  request: FastifyRequest,
  bsId: BrowserSessionId,
  manager: BrowserSessionManager,
  frameStream: BrowserFrameStream,
): void {
  const status = manager.getSession(bsId)
  const state: BrowserSessionState = status ? mapOwnershipToState(status.ownership) : 'idle'

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const snapshot: BrowserSnapshotEvent = {
    type: 'snapshot',
    state,
    url: status ? (manager.getPage(bsId)?.url() ?? null) : null,
    timestamp: new Date().toISOString(),
  }
  reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)

  let unsubscribed = false
  if (status) {
    try {
      frameStream.subscribe(bsId, (meta: FrameMeta, frameData: Buffer) => {
        if (unsubscribed) return
        try {
          const frame: BrowserFrameEvent = {
            type: 'frame',
            data: frameData.toString('base64'),
            timestamp: new Date(meta.capturedAt).toISOString(),
            width: meta.width,
            height: meta.height,
          }
          reply.raw.write(`data: ${JSON.stringify(frame)}\n\n`)
        } catch {
          unsubscribed = true
          frameStream.unsubscribe(bsId)
        }
      })
    } catch {
      // Page not available — stream stays snapshot-only
    }
  }

  const heartbeatInterval = setInterval(() => {
    try {
      const heartbeat: BrowserHeartbeatEvent = { type: 'heartbeat', timestamp: new Date().toISOString() }
      reply.raw.write(`data: ${JSON.stringify(heartbeat)}\n\n`)
    } catch {
      clearInterval(heartbeatInterval)
    }
  }, 5000)

  request.raw.once('close', () => {
    unsubscribed = true
    clearInterval(heartbeatInterval)
    frameStream.unsubscribe(bsId)
  })
}
