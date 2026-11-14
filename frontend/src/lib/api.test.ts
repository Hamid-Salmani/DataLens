import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

class MockUploadRequest {
  upload = new EventTarget()
  status = 202
  responseText = JSON.stringify({
    jobId: '4c4a0f4e-9c2a-4bb7-b844-f8862e1b481b',
    datasetId: '3172dbad-15d7-4a2d-bbac-5ca964c88681',
  })
  body: FormData | null = null
  private readonly events = new EventTarget()

  open = vi.fn()
  setRequestHeader = vi.fn()
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.events.addEventListener(type, listener)
  }
  send(body: FormData) {
    this.body = body
    this.events.dispatchEvent(new Event('load'))
  }
}

describe('dataset upload API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('accepts a 202 response containing the queued job reference', async () => {
    vi.stubGlobal('XMLHttpRequest', MockUploadRequest)
    const file = new File(['Name\nAcme\n'], 'customers.csv', { type: 'text/csv' })

    await expect(api.upload(file, 'Customers', vi.fn())).resolves.toEqual({
      jobId: '4c4a0f4e-9c2a-4bb7-b844-f8862e1b481b',
      datasetId: '3172dbad-15d7-4a2d-bbac-5ca964c88681',
    })
  })
})
