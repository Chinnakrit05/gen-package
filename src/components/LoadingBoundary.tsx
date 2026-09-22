import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { LoadingScreen, type LoadingScreenProps } from './LoadingScreen'

type RegisterStage = (status: LoadingScreenProps) => () => void
const LoadingContext = createContext<RegisterStage | null>(null)

/** Keep the animated DOM above Suspense/auth/project transitions, not inside them. */
export function LoadingBoundary({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<LoadingScreenProps | null>(null)
  const register = useCallback<RegisterStage>((status) => {
    // Each registration owns its cleanup; an old stage must not clear a newer one.
    const owned = { ...status }
    setStage(owned)
    return () => setStage((current) => current === owned ? null : current)
  }, [])

  return (
    <LoadingContext.Provider value={register}>
      {children}
      {stage && <LoadingScreen title={stage.title} message={stage.message} />}
    </LoadingContext.Provider>
  )
}

/** Report loading copy only. The boundary owns the single visible animation. */
export function LoadingStage({ title, message }: LoadingScreenProps) {
  const register = useContext(LoadingContext)
  if (!register) throw new Error('LoadingStage requires a LoadingBoundary')
  // Cleanup and the next registration share the commit, before paint. The box
  // stays mounted when steps change and disappears promptly on ready/error/login.
  useLayoutEffect(() => register({ title, message }), [register, title, message])
  return null
}
