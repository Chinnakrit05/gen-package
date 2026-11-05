export const LEGACY_PROJECTS_STORAGE_KEY = 'gen-package-projects-v1'
export const LEGACY_SINGLE_STORAGE_KEY = 'gen-package-design-v1'

export function hasLegacyMigrationSource(): boolean {
  try {
    return localStorage.getItem(LEGACY_PROJECTS_STORAGE_KEY) !== null
      || localStorage.getItem(LEGACY_SINGLE_STORAGE_KEY) !== null
  } catch {
    return false
  }
}
