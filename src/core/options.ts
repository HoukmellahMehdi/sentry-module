import type { Consola } from 'consola'
import { defu } from 'defu'
import type { Options } from '@sentry/types'
import type { Nuxt } from '@nuxt/schema'
import { resolveAlias } from '@nuxt/kit'
import * as Integrations from '@sentry/integrations'
import type { NuxtOptions } from '@nuxt/types'
import type { IntegrationsConfiguration, LazyConfiguration, TracingConfiguration } from '../../types/sentry'
import type { ModuleConfiguration } from '../../types'
import { canInitialize } from './utils'

export const PLUGGABLE_INTEGRATIONS = ['CaptureConsole', 'Debug', 'Dedupe', 'ExtraErrorData', 'ReportingObserver', 'RewriteFrames', 'Vue']
export const BROWSER_INTEGRATIONS = ['InboundFilters', 'FunctionToString', 'TryCatch', 'Breadcrumbs', 'GlobalHandlers', 'LinkedErrors', 'UserAgent']
const SERVER_INTEGRATIONS = ['CaptureConsole', 'Debug', 'Dedupe', 'ExtraErrorData', 'RewriteFrames', 'Modules', 'Transaction']

const filterDisabledIntegrations = (integrations: IntegrationsConfiguration): string[] => Object.keys(integrations).filter(key => integrations[key])

async function getApiMethods (packageName: string): Promise<string[]> {
  const packageApi = await import(packageName)

  const apiMethods: string[] = []
  for (const key in packageApi) {
    if (typeof packageApi[key] === 'function') {
      apiMethods.push(key)
    }
  }

  return apiMethods
}

export async function resolveRelease (moduleOptions: ModuleConfiguration): Promise<string | undefined> {
  if (!('release' in moduleOptions.config)) {
    // Determine "config.release" automatically from local repo if not provided.
    try {
      const SentryCli = await (import('@sentry/cli').then(m => m.default || m))
      const cli = new SentryCli()
      return (await cli.releases.proposeVersion()).trim()
    } catch {
      // Ignore
    }
  }
}

function resolveLazyOptions (options: ModuleConfiguration, apiMethods: string[], logger: Consola) {
  if (options.lazy) {
    const defaultLazyOptions = {
      injectMock: true,
      injectLoadHook: false,
      mockApiMethods: true,
      chunkName: 'sentry',
      webpackPrefetch: false,
      webpackPreload: false,
    }

    options.lazy = defu(options.lazy, defaultLazyOptions)

    if (!options.lazy.injectMock) {
      options.lazy.mockApiMethods = []
    } else if (options.lazy.mockApiMethods === true) {
      options.lazy.mockApiMethods = apiMethods
    } else if (Array.isArray(options.lazy.mockApiMethods)) {
      const mockMethods = options.lazy.mockApiMethods
      options.lazy.mockApiMethods = mockMethods.filter(method => apiMethods.includes(method))

      const notfoundMethods = mockMethods.filter(method => !apiMethods.includes(method))
      if (notfoundMethods.length) {
        logger.warn('Some specified methods to mock weren\'t found in @sentry/browser:', notfoundMethods)
      }

      if (!options.lazy.mockApiMethods.includes('captureException')) {
      // always add captureException if a sentry mock is requested
        options.lazy.mockApiMethods.push('captureException')
      }
    }
  }
}

function resolveTracingOptions (tracing: ModuleConfiguration['tracing'], config: NonNullable<ModuleConfiguration['config']>) {
  if (!tracing) {
    return
  }
  const defaultTracingOptions: TracingConfiguration = {
    tracesSampleRate: 1.0,
    vueOptions: {
      tracing: true,
      tracingOptions: {
        hooks: ['mount', 'update'],
        timeout: 2000,
        trackComponents: true,
      },
    },
    browserOptions: {},
  }

  const tracingOptions = defu(typeof tracing === 'boolean' ? {} : tracing, defaultTracingOptions)

  if (tracingOptions && !config.tracesSampleRate) {
    config.tracesSampleRate = tracingOptions.tracesSampleRate
  }
}

export type resolvedClientOptions = {
  PLUGGABLE_INTEGRATIONS: string[]
  BROWSER_INTEGRATIONS: string[]
  dev: boolean
  runtimeConfigKey: string
  config: Options
  lazy: boolean | LazyConfiguration
  apiMethods: string[]
  customClientIntegrations: string | undefined
  logMockCalls: boolean
  tracing: boolean | TracingConfiguration
  initialize: boolean
  // TODO Fix this type
  integrations: Record<string, unknown>
}

export async function resolveClientOptions (nuxt: Nuxt, moduleOptions: ModuleConfiguration, logger: Consola): Promise<resolvedClientOptions> {
  const options = moduleOptions

  options.config = defu(options.clientConfig, options.config)

  const apiMethods = await getApiMethods('@sentry/browser')
  resolveLazyOptions(options, apiMethods, logger)
  resolveTracingOptions(options.tracing, options.config)

  for (const name of Object.keys(options.clientIntegrations)) {
    if (!PLUGGABLE_INTEGRATIONS.includes(name) && !BROWSER_INTEGRATIONS.includes(name)) {
      logger.warn(`Sentry clientIntegration "${name}" is not recognized and will be ignored.`)
      delete options.clientIntegrations[name]
    }
  }

  let customClientIntegrations: string | undefined
  if (options.customClientIntegrations) {
    if (typeof (options.customClientIntegrations) === 'string') {
      customClientIntegrations = resolveAlias(options.customClientIntegrations)
    } else {
      logger.warn(`Invalid customServerIntegrations option. Expected a file path, got "${typeof (options.customClientIntegrations)}".`)
    }
  }

  return {
    PLUGGABLE_INTEGRATIONS,
    BROWSER_INTEGRATIONS,
    dev: nuxt.options.dev,
    runtimeConfigKey: options.runtimeConfigKey,
    config: {
      dsn: options.dsn,
      ...options.config,
    },
    lazy: options.lazy,
    apiMethods,
    customClientIntegrations,
    logMockCalls: options.logMockCalls, // for mocked only
    tracing: options.tracing,
    initialize: canInitialize(options),
    integrations: filterDisabledIntegrations(options.clientIntegrations)
      .reduce((res, key) => {
        res[key] = options.clientIntegrations[key]
        return res
      }, {} as Record<string, unknown>),
  }
}

export type resolvedServerOptions = {
  config: Options
  apiMethods: string[]
  lazy: boolean | LazyConfiguration
  logMockCalls: boolean
}

export async function resolveServerOptions (nuxt: Nuxt, moduleOptions: ModuleConfiguration, logger: Consola): Promise<resolvedServerOptions> {
  const options = moduleOptions

  for (const name of Object.keys(options.serverIntegrations)) {
    if (!SERVER_INTEGRATIONS.includes(name)) {
      logger.warn(`Sentry serverIntegration "${name}" is not recognized and will be ignored.`)
      delete options.serverIntegrations[name]
    }
  }

  let customIntegrations = []
  if (options.customServerIntegrations) {
    const resolvedPath = resolveAlias(options.customServerIntegrations)
    customIntegrations = (await import(resolvedPath).then(m => m.default || m))()
    if (!Array.isArray(customIntegrations)) {
      logger.error(`Invalid value returned from customServerIntegrations plugin. Expected an array, got "${typeof (customIntegrations)}".`)
    }
  }

  const defaultConfig = {
    dsn: options.dsn,
    intergrations: [
      ...filterDisabledIntegrations(options.serverIntegrations)
        .map((name) => {
          const opt = options.serverIntegrations[name]
          // TODO Fix this type
          // eslint-disable-next-line import/namespace
          return Object.keys(opt as Record<string, unknown>).length ? new Integrations[name](opt) : new Integrations[name]()
        }),
      ...customIntegrations,
    ],
  }

  options.config = defu(defaultConfig, options.config, options.serverConfig, getRuntimeConfig(nuxt, options))

  const apiMethods = await getApiMethods('@sentry/node')
  resolveLazyOptions(options, apiMethods, logger)
  resolveTracingOptions(options.tracing, options.config)

  return {
    config: options.config,
    apiMethods,
    lazy: options.lazy,
    logMockCalls: options.logMockCalls, // for mocked only
  }
}

function getRuntimeConfig (nuxt: Nuxt, options: ModuleConfiguration): Partial<ModuleConfiguration['config']> | undefined {
  // TODO Fix for nuxt 3
  const { publicRuntimeConfig } = nuxt.options as unknown as NuxtOptions
  const { runtimeConfigKey } = options
  if (typeof (publicRuntimeConfig) !== 'function' && runtimeConfigKey in publicRuntimeConfig) {
    return defu(publicRuntimeConfig[runtimeConfigKey].config as Partial<ModuleConfiguration['config']>, publicRuntimeConfig[runtimeConfigKey].serverConfig as Partial<ModuleConfiguration['serverConfig']>)
  }
}