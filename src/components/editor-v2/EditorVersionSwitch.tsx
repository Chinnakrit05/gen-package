import { useT } from '../../i18n'

export type EditorVersion = 'v1' | 'v2'
export const EDITOR_VERSION_KEY = 'packit-editor-version'

export function loadEditorVersion(): EditorVersion {
  try { return localStorage.getItem(EDITOR_VERSION_KEY) === 'v2' ? 'v2' : 'v1' }
  catch { return 'v1' }
}

export function EditorVersionSwitch({ value, onChange }: { value: EditorVersion; onChange: (value: EditorVersion) => void }) {
  const t = useT()
  return (
    <div className="editor-version-switch" role="group" aria-label={t('เวอร์ชันหน้าเว็บ', 'Editor version')}>
      {(['v1', 'v2'] as const).map((version) => (
        <button key={version} type="button" aria-pressed={value === version}
          title={version === 'v1' ? t('หน้าตาเดิม', 'Classic editor') : t('หน้าตาใหม่', 'New editor')}
          onClick={() => onChange(version)}>{version.toUpperCase()}</button>
      ))}
    </div>
  )
}
