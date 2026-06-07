import { describe, it, expect, vi } from 'vitest'
import {
  createCloakBrowserProvider,
  resolveCloakBrowserLaunchOptions,
} from '../../../src/search/browser/cloakbrowser-launcher.js'

vi.mock('cloakbrowser', () => ({
  launch: vi.fn().mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) }),
}))

describe('cloakbrowser launcher', () => {
  it('maps environment variables to CloakBrowser launch options', () => {
    const options = resolveCloakBrowserLaunchOptions({
      CLOAKBROWSER_HEADLESS: 'false',
      CLOAKBROWSER_PROXY: 'http://user:pass@proxy.example:8080',
      CLOAKBROWSER_HUMANIZE: 'true',
      CLOAKBROWSER_GEOIP: 'true',
      CLOAKBROWSER_TIMEZONE: 'America/New_York',
      CLOAKBROWSER_LOCALE: 'en-US',
      CLOAKBROWSER_ARGS: '--disable-gpu, --no-sandbox',
    })

    expect(options).toEqual({
      headless: false,
      humanize: true,
      geoip: true,
      proxy: 'http://user:pass@proxy.example:8080',
      timezone: 'America/New_York',
      locale: 'en-US',
      args: ['--disable-gpu', '--no-sandbox'],
    })
  })

  it('lazily launches, reuses, and closes a CloakBrowser browser', async () => {
    const { launch } = await import('cloakbrowser')
    const provider = createCloakBrowserProvider({ headless: true })

    const first = await provider.getBrowser()
    const second = await provider.getBrowser()

    expect(first).toBe(second)
    expect(launch).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith({ headless: true })

    await provider.closeBrowser()
    expect(first.close).toHaveBeenCalledOnce()
  })
})
