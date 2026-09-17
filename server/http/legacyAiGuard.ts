export function isLegacyAiRouteEnabled(env: Record<string, string | undefined>): boolean {
  const appEnv = env.APP_ENV?.trim() || (env.NODE_ENV === 'production' ? 'production' : 'development')
  const appMode = env.VITE_APP_MODE?.trim() || 'local'
  return (appEnv === 'development' || appEnv === 'test') && appMode === 'local'
}
