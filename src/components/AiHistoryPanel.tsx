import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { AiHistoryPage } from '../../shared/contracts/aiHistory'
import { useT } from '../i18n'

export interface AiHistorySource {
  appUserId: string
  workspaceId: string
  listAiHistory(cursor: string | null, signal?: AbortSignal): Promise<AiHistoryPage>
}

export function AiHistoryPanel({ source }: { source: AiHistorySource }) {
  const t = useT()
  const client = useQueryClient()
  const queryKey = ['cloud', source.appUserId, source.workspaceId, 'ai-history'] as const
  const history = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => source.listAiHistory(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    gcTime: 0,
    networkMode: 'always',
    retry: false,
  })
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  const dateFormat = new Intl.DateTimeFormat(t('th-TH', 'en-US'), { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <section className="cp-history" aria-labelledby="cp-history-title" aria-busy={history.isFetching}>
      <div className="cp-history-head">
        <h2 id="cp-history-title">{t('ประวัติการใช้ AI', 'AI usage history')}</h2>
        <button
          type="button"
          className="cp-tool cp-history-refresh"
          aria-label={t('รีเฟรชประวัติ', 'Refresh history')}
          title={t('รีเฟรชประวัติ', 'Refresh history')}
          disabled={history.isFetching}
          onClick={() => void client.resetQueries({ queryKey, exact: true })}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      {history.isPending && <p role="status">{t('กำลังโหลดประวัติ…', 'Loading history…')}</p>}
      {history.isError && (
        <p role="alert">{t('โหลดประวัติไม่สำเร็จ ลองอีกครั้งได้', 'Could not load history. Please try again.')}</p>
      )}
      {history.isSuccess && items.length === 0 && (
        <p>{t('ยังไม่มีประวัติการใช้ AI ในพื้นที่งานนี้', 'No AI usage in this workspace yet.')}</p>
      )}
      {items.length > 0 && (
        <ol className="cp-history-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.kind === 'artwork' ? t('ออกแบบหน้าตา', 'Artwork design')
                  : item.kind === 'spec' ? t('สร้างโครงกล่อง', 'Box generation') : 'AI Generate'}</strong>
                <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
              </div>
              <div>
                <strong>{item.status === 'succeeded' ? t('สำเร็จ', 'Succeeded')
                  : item.status === 'failed' ? t('ไม่สำเร็จ', 'Failed') : t('กำลังประมวลผล', 'In progress')}</strong>
                <span>{item.status === 'reserved'
                  ? t(`จอง ${item.creditUnits} เครดิต`, `${item.creditUnits} reserved`)
                  : t(`ใช้ ${item.creditUnits} เครดิต`, `${item.creditUnits} used`)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {history.hasNextPage && (
        <button type="button" className="cp-tool cp-history-more" disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>
          {history.isFetchingNextPage ? t('กำลังโหลด…', 'Loading…') : t('ดูเพิ่มเติม', 'Load more')}
        </button>
      )}
    </section>
  )
}
