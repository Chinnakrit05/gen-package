import type { LoadingScreenProps } from './LoadingScreen'
import './LoginSkeleton.css'

/** Match the login layout while auth is unknown, without presenting fake controls. */
export function LoginSkeleton({ title, message }: LoadingScreenProps) {
  return (
    <main className="login-screen login-skeleton">
      <div className="login-card" aria-hidden="true">
        <div className="login-brand">
          <span className="login-skeleton__block login-skeleton__mark" />
          <span className="login-skeleton__block login-skeleton__name" />
        </div>
        <div className="login-skeleton__block login-skeleton__title" />
        <div className="login-skeleton__description">
          <div className="login-skeleton__block login-skeleton__line" />
          <div className="login-skeleton__block login-skeleton__line login-skeleton__line--short" />
        </div>
        <div className="login-skeleton__block login-skeleton__button" />
        <div className="login-skeleton__block login-skeleton__fine" />
      </div>
      <div className="login-skeleton__block login-skeleton__footer" aria-hidden="true" />
      <div className="login-skeleton__status" role="status" aria-live="polite" aria-atomic="true">
        {title} — {message}
      </div>
    </main>
  )
}
