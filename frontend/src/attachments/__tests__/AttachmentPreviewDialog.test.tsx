// @vitest-environment jsdom
/**
 * Previewing PDFs and text files (#101).
 *
 * What matters most here is what the bytes turn into: a PDF blob always
 * typed application/pdf, text always rendered as text. The rest is the
 * truncation promise and the dialog behaving like a dialog.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentRead } from '@/api/generated/models'
import { AttachmentList } from '@/attachments/AttachmentList'
import { AttachmentPreviewDialog, TEXT_PREVIEW_BYTES } from '@/attachments/AttachmentPreviewDialog'

const mocks = vi.hoisted(() => ({ get: vi.fn(), download: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  AXIOS_INSTANCE: { get: (...args: unknown[]) => mocks.get(...args) },
}))
vi.mock('@/attachments/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/attachments/urls')>()),
  downloadAttachment: (...args: unknown[]) => mocks.download(...args),
}))

function file(overrides: Partial<AttachmentRead>): AttachmentRead {
  return {
    id: 3,
    issue_id: 1,
    filename: 'server.log',
    content_type: 'text/plain',
    size_bytes: 12,
    is_image: false,
    preview: 'text',
    url: '/attachments/3/content',
    uploaded_by: { id: 1, full_name: 'Olivia Owner' },
    created_at: '2026-09-25T09:00:00',
    ...overrides,
  } as AttachmentRead
}

const bytes = (text: string) => ({ data: new TextEncoder().encode(text).buffer })
const blobs: Blob[] = []

beforeEach(() => {
  blobs.length = 0
  mocks.get.mockReset()
  mocks.download.mockReset()
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return 'blob:preview'
  })
  URL.revokeObjectURL = vi.fn()
})

const teardown: Array<() => void> = []
afterEach(() => {
  teardown.splice(0).forEach((undo) => undo())
  cleanup()
})

describe('AttachmentPreviewDialog', () => {
  it('shows text as text, asking only for the first megabyte', async () => {
    mocks.get.mockResolvedValue(bytes('<script>alert(1)</script>\nsecond line'))
    render(<AttachmentPreviewDialog attachment={file({})} onClose={vi.fn()} />)

    const contents = await screen.findByLabelText('Contents of server.log')
    expect(contents.textContent).toBe('<script>alert(1)</script>\nsecond line')
    expect(document.querySelector('script')).toBeNull()
    expect(mocks.get).toHaveBeenCalledWith('/attachments/3/content', {
      responseType: 'arraybuffer',
      headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` },
    })
    expect(screen.queryByText(/truncated/)).toBeNull()
  })

  it('says when a big file is only partly shown, and offers the rest', async () => {
    mocks.get.mockResolvedValue(bytes('first megabyte…'))
    const user = userEvent.setup()
    render(
      <AttachmentPreviewDialog
        attachment={file({ size_bytes: 3 * TEXT_PREVIEW_BYTES })}
        onClose={vi.fn()}
      />,
    )
    expect((await screen.findByText(/truncated/)).textContent).toMatch(
      /Showing the first 1.0 MB of 3.0 MB/,
    )
    await user.click(screen.getByRole('button', { name: 'Download for the rest' }))
    expect(mocks.download).toHaveBeenCalledWith('/attachments/3/content', 'server.log')
  })

  it('does not end a cut-off preview on half a character', async () => {
    // "é" is two bytes; the cut falls between them.
    const cut = new TextEncoder().encode('café').slice(0, 4).buffer
    mocks.get.mockResolvedValue({ data: cut })
    render(
      <AttachmentPreviewDialog attachment={file({ size_bytes: 2 * TEXT_PREVIEW_BYTES })} onClose={vi.fn()} />,
    )
    expect((await screen.findByLabelText('Contents of server.log')).textContent).toBe('caf')
  })

  it('shows a PDF from a blob that is always a PDF', async () => {
    mocks.get.mockResolvedValue(bytes('%PDF-1.7'))
    render(
      <AttachmentPreviewDialog
        attachment={file({ filename: 'spec.pdf', preview: 'pdf', content_type: 'application/pdf' })}
        onClose={vi.fn()}
      />,
    )
    const frame = await screen.findByTitle('spec.pdf')
    expect(frame.getAttribute('src')).toBe('blob:preview')
    expect(blobs.map((blob) => blob.type)).toEqual(['application/pdf'])
    // No Range: a PDF viewer needs the whole file.
    expect(mocks.get.mock.calls[0][1]).toEqual({ responseType: 'arraybuffer' })
  })

  it('lets go of the PDF when it closes', async () => {
    mocks.get.mockResolvedValue(bytes('%PDF-1.7'))
    const { unmount } = render(
      <AttachmentPreviewDialog attachment={file({ preview: 'pdf', filename: 'spec.pdf' })} onClose={vi.fn()} />,
    )
    await screen.findByTitle('spec.pdf')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('offers the download when the file cannot be fetched', async () => {
    mocks.get.mockRejectedValue(new Error('410'))
    render(<AttachmentPreviewDialog attachment={file({})} onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be shown/)
    expect(screen.getByRole('button', { name: 'Download it instead' })).toBeTruthy()
  })

  it('is a modal dialog that Escape closes without reaching what is behind it', async () => {
    mocks.get.mockResolvedValue(bytes('x'))
    const onClose = vi.fn()
    const onWindowEscape = vi.fn()
    const listener = (e: KeyboardEvent) => e.key === 'Escape' && onWindowEscape()
    window.addEventListener('keydown', listener)
    teardown.push(() => window.removeEventListener('keydown', listener))
    const user = userEvent.setup()
    render(<AttachmentPreviewDialog attachment={file({})} onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: 'server.log' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWindowEscape).not.toHaveBeenCalled()
  })
})

describe('AttachmentList', () => {
  it('opens a preview for PDFs and text, and downloads anything else', async () => {
    mocks.get.mockResolvedValue(bytes('boot ok'))
    const user = userEvent.setup()
    render(
      <AttachmentList
        attachments={[
          file({}),
          file({ id: 4, filename: 'dump.zip', preview: null, url: '/attachments/4/content' }),
        ]}
      />,
    )

    await user.click(screen.getByTitle(/dump.zip/))
    expect(mocks.download).toHaveBeenCalledWith('/attachments/4/content', 'dump.zip')
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByTitle(/server.log/))
    expect(await screen.findByRole('dialog', { name: 'server.log' })).toBeTruthy()
    expect(mocks.download).toHaveBeenCalledTimes(1)
  })
})
