import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { Fragment } from 'react'
import type { AiHistoryEntry, AiHistoryPage } from '../../shared/contracts/aiHistory'
import { aiModelLabel } from '../../shared/contracts/aiModels'
import { formatTokens } from '../core/aiUsage'
import { useT } from '../i18n'

export interface AiHistorySource {
  appUserId: string
  workspaceId: string
  listAiHistory(cursor: string | null, signal?: AbortSignal): Promise<AiHistoryPage>
}

function formatDuration(milliseconds: number, t: ReturnType<typeof useT>) {
  if (milliseconds > 0 && milliseconds < 1000) return t('น้อยกว่า 1 วินาที', 'Under 1 second')
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0
    ? t(`${minutes} นาที ${seconds % 60} วินาที`, `${minutes} min ${seconds % 60} sec`)
    : t(`${seconds} วินาที`, `${seconds} sec`)
}

function AiHistoryItem({ item, clockFormat, timeFormat }: {
  item: AiHistoryEntry
  clockFormat: Intl.DateTimeFormat
  timeFormat: Intl.DateTimeFormat
}) {
  const t = useT()
  const unknown = t('ไม่มีข้อมูล', 'Not recorded')
  const started = new Date(item.createdAt)
  const finished = item.settledAt ? new Date(item.settledAt) : null
  const elapsed = finished ? finished.getTime() - started.getTime() : null
  const model = item.model ? aiModelLabel(item.model) : null
  const title = item.kind === 'artwork' ? t('ออกแบบหน้าตา', 'Artwork design')
    : item.kind === 'spec' ? t('สร้างโครงกล่อง', 'Box generation') : model ?? 'AI Generate'
  const statusLabel = item.status === 'succeeded' ? t('สำเร็จ', 'Succeeded')
    : item.status === 'failed' ? t('ไม่สำเร็จ', 'Failed') : t('กำลังประมวลผล', 'In progress')
  const creditLabel = item.status === 'reserved'
    ? t(`จอง ${item.creditUnits} เครดิต`, `${item.creditUnits} reserved`)
    : t(`ใช้ ${item.creditUnits} เครดิต`, `${item.creditUnits} used`)
  const tokenRows = [
    { label: t('ข้อมูลเข้า', 'Input'), count: item.inputTokens },
    { label: t('ผลลัพธ์ (รวมการคิด)', 'Output (incl. thinking)'), count: item.outputTokens },
    { label: t('อ่านแคช', 'Cache read'), count: item.cacheReadTokens },
    { label: t('เขียนแคช', 'Cache write'), count: item.cacheCreationTokens },
  ]
  const hasTokenData = tokenRows.some(({ count }) => count != null)
  const totalTokens = tokenRows.every(({ count }) => count != null)
    ? tokenRows.reduce((total, { count }) => total + (count ?? 0), 0)
    : null

  return (
    <li>
      <details className="cp-history-item">
        <summary className="cp-history-summary">
          <span>
            <strong>{title}</strong>
            <time dateTime={item.createdAt}>{clockFormat.format(started)}</time>
          </span>
          <span className="cp-history-result">
            <strong className="cp-history-status" data-status={item.status}>{statusLabel}</strong>
            <small>{creditLabel}</small>
          </span>
          <ChevronDown className="cp-history-chevron" size={16} aria-hidden="true" />
        </summary>
        <div className="cp-history-details">
          <dl>
            <dt>{t('รุ่น AI', 'Model')}</dt>
            <dd>{model ?? unknown}</dd>
            <dt>{t('เริ่ม', 'Started')}</dt>
            <dd><time dateTime={item.createdAt}>{timeFormat.format(started)}</time></dd>
            <dt>{t('สิ้นสุด', 'Finished')}</dt>
            <dd>{finished && item.settledAt
              ? <time dateTime={item.settledAt}>{timeFormat.format(finished)}</time>
              : item.status === 'reserved' ? t('ยังไม่สิ้นสุด', 'Still in progress') : unknown}</dd>
            <dt>{t('ระยะเวลา', 'Duration')}</dt>
            <dd>{elapsed != null && elapsed >= 0 ? formatDuration(elapsed, t) : unknown}</dd>
            <dt>{t('แนบรูป', 'Image attached')}</dt>
            <dd>{item.hasImage == null ? unknown : item.hasImage ? t('มี', 'Yes') : t('ไม่มี', 'No')}</dd>
            <dt>{t('เครดิต', 'Credits')}</dt>
            <dd>{item.status === 'failed'
              ? t(`คืนเครดิตแล้ว · ${creditLabel}`, `Refunded · ${creditLabel}`)
              : creditLabel}</dd>
          </dl>
          <div className="cp-history-tokens">
            <h3>{t('โทเคน', 'Tokens')}</h3>
            {hasTokenData ? (
              <dl>
                {tokenRows.map(({ label, count }) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{count == null ? unknown : formatTokens(count)}</dd>
                  </Fragment>
                ))}
                {totalTokens != null && (
                  <>
                    <dt className="cp-history-token-total">{t('รวม', 'Total')}</dt>
                    <dd className="cp-history-token-total">{formatTokens(totalTokens)}</dd>
                  </>
                )}
              </dl>
            ) : <p>{unknown}</p>}
          </div>
        </div>
      </details>
    </li>
  )
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
  const locale = t('th-TH', 'en-US')
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const clockFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' })
  const groups = new Map<number, AiHistoryEntry[]>()
  for (const item of items) {
    const day = new Date(item.createdAt).setHours(0, 0, 0, 0)
    const group = groups.get(day)
    if (group) group.push(item)
    else groups.set(day, [item])
  }

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
      <div className="cp-history-body">
        {history.isPending && <p role="status">{t('กำลังโหลดประวัติ…', 'Loading history…')}</p>}
        {history.isError && (
          <p role="alert">{t('โหลดประวัติไม่สำเร็จ ลองอีกครั้งได้', 'Could not load history. Please try again.')}</p>
        )}
        {history.isSuccess && items.length === 0 && (
          <p>{t('ยังไม่มีประวัติการใช้ AI ในพื้นที่งานนี้', 'No AI usage in this workspace yet.')}</p>
        )}
        {[...groups].map(([day, entries]) => (
          <div key={day} className="cp-history-group">
            <h3>{dateFormat.format(day)}</h3>
            <ol className="cp-history-list" role="list">
              {entries.map((item) => <AiHistoryItem key={item.id} item={item} clockFormat={clockFormat} timeFormat={timeFormat} />)}
            </ol>
          </div>
        ))}
        {history.hasNextPage && (
          <button type="button" className="cp-tool cp-history-more" disabled={history.isFetching} onClick={() => void history.fetchNextPage()}>
            {history.isFetchingNextPage ? t('กำลังโหลด…', 'Loading…') : t('ดูเพิ่มเติม', 'Load more')}
          </button>
        )}
      </div>
    </section>
  )
}
