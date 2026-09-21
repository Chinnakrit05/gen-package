import packitMark from '../assets/packit-mark.png'
import './LoadingScreen.css'

export interface LoadingScreenProps {
  title: string
  message: string
}

/** Shared, indeterminate loading UI. The caller owns when loading actually ends. */
export function LoadingScreen({ title, message }: LoadingScreenProps) {
  return (
    <main className="packit-loading">
      <div className="packit-loading__card">
        <div className="packit-loading__brand" aria-hidden="true">PackIt<span>.</span></div>
        <div className="packit-loading__stage" aria-hidden="true">
          <div className="packit-loading__shadow" />
          <div className="packit-loading__scene">
            <div className="packit-loading__net">
              <div className="packit-loading__face packit-loading__base" />
              <div className="packit-loading__face packit-loading__front" />
              <div className="packit-loading__face packit-loading__back">
                <div className="packit-loading__face packit-loading__lid">
                  <img className="packit-loading__lid-logo" src={packitMark} alt="" width="48" height="48" draggable={false} />
                </div>
              </div>
              <div className="packit-loading__face packit-loading__left" />
              <div className="packit-loading__face packit-loading__right" />
            </div>
          </div>
        </div>
        <div className="packit-loading__status" role="status" aria-live="polite" aria-atomic="true">
          <h1 className="packit-loading__title">{title}</h1>
          <p className="packit-loading__message">{message}</p>
        </div>
        <div className="packit-loading__signature" aria-hidden="true">
          <span /> MADE TO TAKE SHAPE <span />
        </div>
      </div>
    </main>
  )
}
