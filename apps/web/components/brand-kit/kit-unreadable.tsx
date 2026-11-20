'use client'

// What shows in place of the kit's form when the kit couldn't be fetched or read: an error and a
// reload, never an empty form that would be saved over the kit.
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

export function KitUnreadable({ tight = false }: { tight?: boolean }) {
  const t = useMessages().editor.brandKit
  return (
    <div role="alert" data-testid="kit-unreadable">
      <EmptyState
        pose="dizzy"
        tight={tight}
        title={t.unreadable}
        action={
          <Button variant="primary" size={tight ? 'md' : 'lg'} onClick={() => window.location.reload()}>
            {t.reload}
          </Button>
        }
      />
    </div>
  )
}
