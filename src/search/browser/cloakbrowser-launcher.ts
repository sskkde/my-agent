import type { Browser } from 'playwright-core'
import type { LaunchOptions } from 'cloakbrowser'

export interface CloakBrowserProvider {
  getBrowser: () => Promise<Browser>
  closeBrowser: () => Promise<void>
}

export interface CloakBrowserEnv {
  CLOAKBROWSER_HEADLESS?: string
  CLOAKBROWSER_PROXY?: string
  CLOAKBROWSER_HUMANIZE?: string
  CLOAKBROWSER_GEOIP?: string
  CLOAKBROWSER_TIMEZONE?: string
  CLOAKBROWSER_LOCALE?: string
  CLOAKBROWSER_ARGS?: string
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }

  return defaultValue
}

function parseArgs(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }

  const args = value
    .split(',')
    .map((arg) => arg.trim())
    .filter(Boolean)

  return args.length > 0 ? args : undefined
}

export function resolveCloakBrowserLaunchOptions(env: CloakBrowserEnv = process.env): LaunchOptions {
  const options: LaunchOptions = {
    headless: parseBoolean(env.CLOAKBROWSER_HEADLESS, true),
    humanize: parseBoolean(env.CLOAKBROWSER_HUMANIZE, false),
    geoip: parseBoolean(env.CLOAKBROWSER_GEOIP, false),
  }

  if (env.CLOAKBROWSER_PROXY) {
    options.proxy = env.CLOAKBROWSER_PROXY
  }
  if (env.CLOAKBROWSER_TIMEZONE) {
    options.timezone = env.CLOAKBROWSER_TIMEZONE
  }
  if (env.CLOAKBROWSER_LOCALE) {
    options.locale = env.CLOAKBROWSER_LOCALE
  }

  const args = parseArgs(env.CLOAKBROWSER_ARGS)
  if (args) {
    options.args = args
  }

  return options
}

export function createCloakBrowserProvider(
  options: LaunchOptions = resolveCloakBrowserLaunchOptions(),
): CloakBrowserProvider {
  let browserPromise: Promise<Browser> | undefined

  const getBrowser = async (): Promise<Browser> => {
    if (!browserPromise) {
      browserPromise = import('cloakbrowser').then(({ launch }) => launch(options))
    }

    return browserPromise
  }

  const closeBrowser = async (): Promise<void> => {
    if (!browserPromise) {
      return
    }

    const browser = await browserPromise
    browserPromise = undefined
    await browser.close()
  }

  return {
    getBrowser,
    closeBrowser,
  }
}
