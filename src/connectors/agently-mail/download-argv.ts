import { validateDownloadOutputDir } from './attachment-policy.js'

const MESSAGE_ID_RE = /^msg_/
const ATTACHMENT_ID_RE = /^att_/

export type DownloadArgvResult =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly message: string }

export function buildDownloadAttachmentArgv(params: Record<string, unknown>): DownloadArgvResult {
  const { msg, att, output } = params
  if (typeof msg !== 'string' || !MESSAGE_ID_RE.test(msg)) {
    return { ok: false, message: 'Invalid message ID: expected string starting with "msg_"' }
  }
  if (typeof att !== 'string' || !ATTACHMENT_ID_RE.test(att)) {
    return { ok: false, message: 'Invalid attachment ID: expected string starting with "att_"' }
  }

  const argv = ['attachment', '+download', '--msg', msg, '--att', att]
  if (output !== undefined) {
    if (typeof output !== 'string') {
      return { ok: false, message: 'Invalid output directory: expected string' }
    }
    const validation = validateDownloadOutputDir(output)
    if (!validation.valid) {
      return { ok: false, message: validation.error ?? 'Invalid output directory' }
    }
    argv.push('--output', output)
  }

  return { ok: true, argv }
}
