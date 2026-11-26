import { describe, expect, it } from 'vitest'

import { startAnswer } from './ai-client.ts'

describe('startAnswer', () => {
  it('gives the job of a started one', () => {
    expect(startAnswer(201, { job: 'j1', briefId: 'b1' })).toEqual({ ok: true, job: 'j1' })
  })

  it('gives why saving it was refused, with the API’s words', () => {
    expect(startAnswer(409, { error: 'This month’s AI is used up', refusal: 'used-up' })).toEqual({
      ok: false,
      refusal: 'used-up',
      message: 'This month’s AI is used up',
    })
  })

  it('gives no refusal for a request refused for what it names, nor for an answer that isn’t JSON', () => {
    expect(startAnswer(404, { error: 'No such design' })).toEqual({
      ok: false,
      refusal: null,
      message: 'No such design',
    })
    expect(startAnswer(502, null)).toEqual({ ok: false, refusal: null, message: '502' })
  })
})
