// Object storage over the S3 API: RustFS in Docker Compose locally and in CI, Cloudflare R2 when
// deployed. Settings come from the environment only. Browsers never get credentials: uploads go
// straight to storage through short-lived signed URLs, and reads come back through the API.
import { AwsClient } from 'aws4fetch'

export * from './keys.ts'

export interface StorageSettings {
  /** The S3 endpoint, such as http://127.0.0.1:59000 or https://<account>.r2.cloudflarestorage.com. */
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** "auto" for R2. */
  region: string
  /** Where browsers reach storage, for signed URLs; the endpoint itself when left out. */
  publicEndpoint?: string
}

export type Storage = ReturnType<typeof openStorage>

export class StorageError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The escapes an S3 answer's XML text uses, by name. */
const XML_ESCAPES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }

export function openStorage(settings: StorageSettings) {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
  })
  const path = (key: string) => `${settings.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const objectUrl = (key: string) => `${settings.endpoint}/${path(key)}`
  const publicUrl = (key: string) => `${settings.publicEndpoint ?? settings.endpoint}/${path(key)}`

  async function send(url: string, init: RequestInit = {}) {
    const response = await client.fetch(url, init)
    if (!response.ok && response.status !== 404) {
      throw new StorageError(
        response.status,
        `storage answered ${response.status} to ${init.method ?? 'GET'}: ${(await response.text()).slice(0, 200)}`,
      )
    }
    return response
  }

  /** A URL that lets its holder do one method on one key until it expires; nothing else. */
  async function sign(
    method: 'GET' | 'PUT',
    key: string,
    expiresInSeconds: number,
    headers: Record<string, string> = {},
  ) {
    const url = new URL(publicUrl(key))
    url.searchParams.set('X-Amz-Expires', String(expiresInSeconds))
    // allHeaders: sign content-type and content-length too, which aws4fetch leaves out by default.
    const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true, allHeaders: true } })
    return signed.url
  }

  /** Creates the bucket when it is missing; for local and CI storage, where we own the server. */
  async function ensureBucket() {
    const url = `${settings.endpoint}/${settings.bucket}`
    if ((await send(url, { method: 'HEAD' })).ok) return
    await send(url, { method: 'PUT' })
  }

  /** Stores the object; throws when the bucket is missing, so a write is never taken as stored when it wasn't. */
  async function put(key: string, bytes: Uint8Array, contentType: string) {
    const response = await send(objectUrl(key), {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': contentType },
    })
    if (response.status === 404) throw new StorageError(404, `storage has no bucket ${settings.bucket}`)
  }

  /** The object's bytes, or null when there is none. */
  async function get(key: string): Promise<Uint8Array | null> {
    const response = await send(objectUrl(key))
    return response.status === 404 ? null : new Uint8Array(await response.arrayBuffer())
  }

  /**
   * The object's bytes as they arrive, asked for as stored rather than compressed, and how many there are when
   * storage names it for the bytes as stored, not for a compressed answer it sent anyway; null when there is none.
   */
  async function stream(key: string): Promise<{ body: ReadableStream<Uint8Array>; byteSize: number | null } | null> {
    const response = await send(objectUrl(key), { headers: { 'accept-encoding': 'identity' } })
    if (response.status === 404 || !response.body) {
      await response.body?.cancel()
      return null
    }
    const length = response.headers.get('content-length')
    const encoding = response.headers.get('content-encoding')
    const asStored = encoding === null || encoding.trim().toLowerCase() === 'identity'
    return { body: response.body, byteSize: length === null || !asStored ? null : Number(length) }
  }

  async function remove(key: string) {
    await send(objectUrl(key), { method: 'DELETE' })
  }

  async function exists(key: string): Promise<boolean> {
    return (await send(objectUrl(key), { method: 'HEAD' })).ok
  }

  /** The keys of every object whose key starts with `prefix`, read `pageSize` (at most 1,000) at a time. */
  async function list(prefix: string, pageSize = 1000): Promise<string[]> {
    const keys: string[] = []
    let token: string | null = null
    do {
      const url = new URL(`${settings.endpoint}/${settings.bucket}`)
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', prefix)
      url.searchParams.set('max-keys', String(pageSize))
      if (token) url.searchParams.set('continuation-token', token)
      const response = await send(url.toString())
      // A missing bucket is no empty folder.
      if (response.status === 404) throw new StorageError(404, `storage has no bucket ${settings.bucket}`)
      const page = await response.text()
      keys.push(...[...page.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => xmlText(match[1] ?? '')))
      const next = /<IsTruncated>true<\/IsTruncated>/.test(page) && /<NextContinuationToken>([^<]*)</.exec(page)
      token = next ? xmlText(next[1] ?? '') : null
    } while (token)
    return keys
  }

  /**
   * Deletes every object in the folder `prefix`, which ends in `/` so it never reaches a folder whose name
   * only starts the same; an empty folder is left be.
   */
  async function deleteFolder(prefix: string) {
    if (!prefix.endsWith('/') || prefix === '/') throw new Error(`not a folder: ${prefix}`)
    for (const key of await list(prefix)) await remove(key)
  }

  /** A URL to upload one object of exactly this content type and size. */
  function signedPut(key: string, contentType: string, byteSize: number, expiresInSeconds: number) {
    return sign('PUT', key, expiresInSeconds, { 'content-type': contentType, 'content-length': String(byteSize) })
  }

  function signedGet(key: string, expiresInSeconds: number) {
    return sign('GET', key, expiresInSeconds)
  }

  return {
    ensureBucket,
    put,
    get,
    stream,
    delete: remove,
    exists,
    list,
    deleteFolder,
    signedPut,
    signedGet,
    /** The unsigned public address of an object, which storage must refuse. */
    publicUrl,
  }
}

/** Text from an S3 answer's XML, its five escapes undone. */
function xmlText(text: string): string {
  return text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => XML_ESCAPES[name] ?? '')
}

/**
 * Settings from STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY,
 * STORAGE_REGION and STORAGE_PUBLIC_ENDPOINT.
 */
export function storageSettings(env: NodeJS.ProcessEnv = process.env): StorageSettings {
  const read = (name: string) => {
    const value = env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  return {
    endpoint: read('STORAGE_ENDPOINT').replace(/\/+$/, ''),
    bucket: read('STORAGE_BUCKET'),
    accessKeyId: read('STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: read('STORAGE_SECRET_ACCESS_KEY'),
    region: env.STORAGE_REGION ?? 'auto',
    ...(env.STORAGE_PUBLIC_ENDPOINT ? { publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT.replace(/\/+$/, '') } : {}),
  }
}
