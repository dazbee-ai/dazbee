// A stand-in for Pixabay's search API, for tests: it answers searches and look-ups by id from the photos a test
// gives it, as Pixabay's JSON, notes every request it is sent, and answers the next requests as a test asks.

/** A photo as Pixabay's API answers it, with the fields Dazbee reads and a few it doesn't. */
export interface TestPixabayHit {
  id: number
  pageURL: string
  type: string
  tags: string
  previewURL: string
  previewWidth: number
  previewHeight: number
  webformatURL: string
  largeImageURL: string
  imageWidth: number
  imageHeight: number
  views: number
  user_id: number
  user: string
}

/** The stand-in, and what it was sent. */
export interface TestPixabay {
  /** The `fetch` the Pixabay client is given. */
  fetch: typeof fetch
  /** Adds a photo searches and look-ups find; the fields not given are made from its id. */
  add(photo: Partial<TestPixabayHit> & { id: number; tags: string }): TestPixabayHit
  /** Answers the next request with `answer` instead, once for each call. */
  answerNext(answer: () => Response | Promise<Response>): void
  /** The requests sent, in order. */
  requests: URL[]
}

/** The address of Pixabay's search API. */
export const TEST_PIXABAY_URL = 'https://pixabay.com/api/'

/** Starts the stand-in. */
export function testPixabay(): TestPixabay {
  const photos = new Map<number, TestPixabayHit>()
  const next: (() => Response | Promise<Response>)[] = []
  const requests: URL[] = []

  const answer = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input)
    requests.push(url)
    const given = next.shift()
    if (given) return given()
    if (`${url.origin}${url.pathname}` !== TEST_PIXABAY_URL) return new Response('not found', { status: 404 })
    if (!url.searchParams.get('key')) return new Response('[ERROR 400] "key" is required.', { status: 400 })
    const id = url.searchParams.get('id')
    if (id !== null) {
      const photo = photos.get(Number(id))
      if (!photo) return new Response('[ERROR 400] "id" is out of valid range.', { status: 400 })
      return found([photo])
    }
    const words = (url.searchParams.get('q') ?? '')
      .toLowerCase()
      .split(/[\s+]+/)
      .filter(Boolean)
    return found([...photos.values()].filter(({ tags }) => words.some((word) => tags.includes(word))))
  }

  return {
    fetch: answer as typeof fetch,
    add: (photo) => {
      const made: TestPixabayHit = {
        pageURL: `https://pixabay.com/photos/photo-${photo.id}/`,
        type: 'photo',
        previewURL: `https://cdn.pixabay.com/photo/${photo.id}_150.jpg`,
        previewWidth: 150,
        previewHeight: 100,
        webformatURL: `https://pixabay.com/get/w${photo.id}_640.jpg`,
        largeImageURL: `https://pixabay.com/get/g${photo.id}_1280.png`,
        imageWidth: 6000,
        imageHeight: 4000,
        views: 100,
        user_id: 7,
        user: 'Photographer',
        ...photo,
      }
      photos.set(photo.id, made)
      return made
    },
    answerNext: (given) => void next.push(given),
    requests,
  }
}

/** Pixabay's answer holding `hits`, with its rate limit headers. */
function found(hits: TestPixabayHit[]): Response {
  return Response.json(
    { total: hits.length, totalHits: hits.length, hits },
    { headers: { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '99', 'x-ratelimit-reset': '60' } },
  )
}
