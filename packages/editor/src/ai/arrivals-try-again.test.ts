import { afterEach, describe, expect, it } from 'vitest'

import { WAITING_FILL } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { fakeAi } from './test-ai.ts'
import { BRIEF, endTabs, fillsOf, pictureOf, pollAll, serve, settle, tabOn } from './test-arrivals.ts'

afterEach(endTabs)

describe('editorArrivals', () => {
  describe('tryAgain', () => {
    it('starts a failed draft again, and its picture fills the same frame as no undo step', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.fail('job1', 0)
      await pollAll(a)
      expect(a.arrivals.read()?.frames.find((f) => f.frameId === 'ann-1')?.state).toBe('failed')
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])

      const started = await a.arrivals.tryAgain('ann-1')
      await settle(a.arrivals)

      expect(started).toEqual({ ok: true, job: 'job2' })
      expect(ai.started[1]).toEqual({ kind: 'try-again', designId: 'd', frameId: 'ann-1' })
      expect(a.arrivals.waiting()).toContain('ann-1')
      ai.makeCall('job2', 0, 'pic5')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic5'))
      expect(a.editor.core.canUndo()).toBe(false)
    })
  })
})
