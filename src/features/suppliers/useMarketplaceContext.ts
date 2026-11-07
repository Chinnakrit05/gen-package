import { useQuery } from '@tanstack/react-query'
import { useCloudSession } from '../../app/cloudSession'
import { getMarketplaceContext, marketplaceContextKey } from '../../services/api/marketplace'

export function useMarketplaceContext() {
  const session = useCloudSession()
  return useQuery({
    queryKey: marketplaceContextKey(session.appUserId),
    queryFn: ({ signal }) => getMarketplaceContext(session.apiBaseUrl, session.getAccessToken(), signal),
    retry: false,
  })
}
