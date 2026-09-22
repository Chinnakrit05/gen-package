// Run npm run dev, open /tests/browser/loading-continuity.html, then click Run.
// Real browser/React/CSS regression; no backend, credentials or extra dependency.
import { act, lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { LoadingBoundary, LoadingStage } from '../../src/components/LoadingBoundary'
import { Login } from '../../src/components/Login'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/prompt/400.css'
import '../../src/app.css'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Phase = 'session' | 'account' | 'project' | 'ready' | 'error' | 'login'
interface StepProps { phase: Phase; revision: number; account: string }

function ProjectStep({ revision }: StepProps) {
  return <LoadingStage title="กำลังเปิดงาน" message={`กำลังโหลดโปรเจกต์และฉบับร่างล่าสุด… ${revision}`} />
}

function AccountStep(props: StepProps) {
  if (props.phase === 'session') return <LoadingStage variant="login" title="กำลังเตรียมหน้าเข้าสู่ระบบ" message={`กำลังตรวจสอบการเข้าสู่ระบบของคุณ… ${props.revision}`} />
  if (props.phase === 'account') return <LoadingStage title="กำลังตรวจสอบบัญชี" message={`กำลังเตรียมพื้นที่ทำงานของคุณ… ${props.revision}`} />
  if (props.phase === 'project') return <ProjectStep key={props.account} {...props} />
  if (props.phase === 'error') return <p role="alert">เปิดงานไม่ได้</p>
  if (props.phase === 'login') return <Login onLogin={() => {}} />
  return <p>Editor ready</p>
}

const host = document.getElementById('test-root')!
const root = createRoot(host)
const results = document.getElementById('results')!
const runButton = document.getElementById('run') as HTMLButtonElement
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
function check(condition: unknown, label: string): asserts condition {
  const item = document.createElement('li')
  item.textContent = `${condition ? 'PASS' : 'FAIL'} — ${label}`
  results.append(item)
  if (!condition) throw new Error(label)
}

async function run() {
  runButton.disabled = true
  results.replaceChildren()
  try {
    // Start afresh so this fixture can be rerun without a page reload.
    await act(async () => root.render(null))
    let resolveAccount!: (module: { default: typeof AccountStep }) => void
    const accountModule = new Promise<{ default: typeof AccountStep }>((resolve) => { resolveAccount = resolve })
    const LazyAccount = lazy(() => accountModule)
    const render = async (phase: Phase, revision = 1, account = 'a') => {
      await act(async () => root.render(
        <StrictMode>
          <LoadingBoundary>
            <Suspense fallback={<LoadingStage variant="login" title="กำลังเตรียมหน้าเข้าสู่ระบบ" message="กำลังตรวจสอบการเข้าสู่ระบบของคุณ…" />}>
              <LazyAccount phase={phase} revision={revision} account={account} />
            </Suspense>
          </LoadingBoundary>
        </StrictMode>,
      ))
      await frame()
    }

    await render('session')
    const skeleton = host.querySelector('.login-skeleton')!
    check(skeleton && !host.querySelector('.packit-loading')
      && host.querySelectorAll('[role="status"]').length === 1, 'lazy auth module shows only the login skeleton')
    await act(async () => resolveAccount({ default: AccountStep }))
    await frame()
    check(host.querySelector('.login-skeleton') === skeleton, 'lazy fallback → unknown session keeps the same skeleton')
    await render('session', 2)
    check(host.querySelector('.login-skeleton') === skeleton && host.textContent?.includes('2'), 'unknown-session response updates skeleton copy without remounting')
    await render('login')
    check(!host.querySelector('.login-skeleton') && !host.querySelector('.packit-loading')
      && host.querySelector('.google-btn'), 'signed-out session reveals real login with no folding-box flash')
    await render('session')
    await render('account')
    check(!host.querySelector('.login-skeleton') && host.querySelector('.packit-loading'), 'confirmed session switches from skeleton to folding box')
    const screen = host.querySelector('.packit-loading')!
    const net = host.querySelector('.packit-loading__net')!
    const faces = [...host.querySelectorAll('.packit-loading__face')]
    const animated = [net, ...faces, host.querySelector('.packit-loading__shadow')!]
    const motions = animated.map((element) => element.getAnimations())
    await Promise.all(motions.flat().map((animation) => animation.ready))
    const starts = motions.map((animations) => animations.map((animation) => animation.startTime))
    const expectedMotions = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 7
    check(screen && faces.length === 6 && motions.flat().length === expectedMotions
      && host.querySelectorAll('[role="status"]').length === 1, 'one folding loader with expected CSS motion after login')
    const continuous = (label: string) => check(
      host.querySelector('.packit-loading') === screen
      && host.querySelector('.packit-loading__net') === net
      && faces.every((face) => face.isConnected)
      && animated.every((element, index) => {
        const current = element.getAnimations()
        return current.length === motions[index].length && current.every((animation, motion) =>
          animation === motions[index][motion] && animation.startTime === starts[index][motion])
      })
      && host.querySelectorAll('[role="status"]').length === 1,
      label,
    )

    check(host.querySelector('h1')?.textContent === 'กำลังตรวจสอบบัญชี', 'account response updates only the copy')
    await render('account', 2)
    continuous('account response update does not restart the folding animation')
    await render('project')
    continuous('account → nested project loader keeps every animated face')
    check(host.querySelector('h1')?.textContent === 'กำลังเปิดงาน', 'project response updates the displayed stage')
    await render('project', 2)
    continuous('project response update does not restart the animation')
    await render('project', 3, 'b')
    continuous('keyed workspace replacement keeps the shared loader')
    await render('ready')
    check(!host.querySelector('.packit-loading') && host.textContent?.includes('Editor ready'), 'ready removes loader without an artificial delay')
    await render('account')
    await render('error')
    check(!host.querySelector('.packit-loading') && host.querySelector('[role="alert"]'), 'error is not covered by a stale loader')
    await render('account')
    await render('login')
    check(!host.querySelector('.packit-loading') && host.textContent?.includes('เข้าสู่ระบบ'), 'signed-out login has no stale loader')
    await render('project')
    await act(async () => root.render(null))
    check(!host.querySelector('.packit-loading'), 'unmount cleans up the loading presentation')
    await render('session')
    await render('error')
    check(!host.querySelector('.login-skeleton') && host.querySelector('[role="alert"]'), 'error removes the login skeleton')
    await render('session')
    await act(async () => root.render(null))
    check(!host.querySelector('.login-skeleton'), 'unmount cleans up the login skeleton')
    runButton.textContent = `All ${results.children.length} checks passed — run again`
  } catch (error) {
    const item = document.createElement('li')
    item.textContent = `ERROR — ${error instanceof Error ? error.message : String(error)}`
    results.append(item)
    runButton.textContent = 'Checks failed — run again'
  } finally {
    runButton.disabled = false
  }
}

const startRun = () => { void run() }
runButton.addEventListener('click', startRun)
const preview = document.getElementById('preview') as HTMLSelectElement
const theme = document.getElementById('theme') as HTMLButtonElement
const showPreview = async () => {
  await act(async () => root.render(
    <LoadingBoundary><AccountStep phase={preview.value as Phase} revision={1} account="preview" /></LoadingBoundary>,
  ))
}
const toggleTheme = () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
}
preview.addEventListener('change', showPreview)
theme.addEventListener('click', toggleTheme)
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    runButton.removeEventListener('click', startRun)
    preview.removeEventListener('change', showPreview)
    theme.removeEventListener('click', toggleTheme)
    void act(() => root.unmount())
  })
}
