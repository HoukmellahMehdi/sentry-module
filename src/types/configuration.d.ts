import { Configuration as WebpackOptions } from 'webpack'
import { Options as SentryOptions, IntegrationClass } from '@sentry/types'
import * as PluggableIntegrations from '@sentry/integrations'
import { BrowserTracing, Integrations as BrowserIntegrations, Replay, vueRouterInstrumentation } from '@sentry/vue'
import { Options as SentryVueOptions, TracingOptions as SentryVueTracingOptions } from '@sentry/vue/types/types'
import { SentryWebpackPluginOptions } from '@sentry/webpack-plugin'
import { Integrations as NodeIntegrations, NodeOptions, Handlers } from '@sentry/node'

type IntegrationsConfig<T extends Record<keyof T, IntegrationClass<unknown>>> = Partial<{
    [K in keyof T]: ConstructorParameters<T[K]>[0] | Record<string, never> | false
}>

// A replacement type since we don't want to depend on `@sentry/profiling-node`
type ProfilingIntegration = { ProfilingIntegration?: Record<string, never> | false }

type ClientIntegrations = IntegrationsConfig<typeof BrowserIntegrations & typeof PluggableIntegrations & { Replay: typeof Replay }>
type ServerIntegrations = IntegrationsConfig<typeof NodeIntegrations & typeof PluggableIntegrations> & ProfilingIntegration
type AllIntegrations = ClientIntegrations | ServerIntegrations

export interface LazyConfiguration {
    chunkName?: string
    injectLoadHook?: boolean
    injectMock?: boolean
    mockApiMethods?: boolean | string[]
    webpackPrefetch?: boolean
    webpackPreload?: boolean
}

export interface TracingConfiguration extends Pick<SentryOptions, 'tracesSampleRate'> {
    browserTracing?: Partial<BrowserTracing['options']>
    vueOptions?: Partial<SentryVueTracingOptions>
    vueRouterInstrumentationOptions?: Parameters<typeof vueRouterInstrumentation>[1]
}

export interface ModuleConfiguration {
  clientConfig: Partial<SentryVueOptions> | string
  clientIntegrations: ClientIntegrations
  config: SentryOptions
  customClientIntegrations: string
  customServerIntegrations: string
  disableClientRelease: boolean
  disableClientSide: boolean
  disabled: boolean
  disableServerRelease: boolean
  disableServerSide: boolean
  dsn: string
  tracing: boolean | TracingConfiguration
  initialize: boolean
  lazy: boolean | LazyConfiguration
  logMockCalls: boolean
  /** See available options at https://docs.sentry.io/platforms/node/sourcemaps/uploading/webpack/ */
  publishRelease: boolean | SentryWebpackPluginOptions
  runtimeConfigKey: string
  serverConfig: NodeOptions | string
  serverIntegrations: ServerIntegrations
  sourceMapStyle: WebpackOptions['devtool']
  requestHandlerConfig: Handlers.RequestHandlerOptions
}

export type PartialModuleConfiguration = Partial<ModuleConfiguration>
