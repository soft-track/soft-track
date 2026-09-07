import { describe, expect, it } from 'vitest'

import { attachmentMarkdown, formatBytes, isAttachmentUrl } from '@/attachments/urls'

describe('isAttachmentUrl', () => {
  it('matches the shape the API returns', () => {
    expect(isAttachmentUrl('/attachments/12/content')).toBe(true)
  })

  it.each([
    'https://example.com/attachments/12/content',
    '/attachments/12',
    '/attachments/abc/content',
    '/attachments/12/content?token=x',
    'attachments/12/content',
    undefined,
  ])('does not match %s', (url) => {
    // An ordinary image in a description must stay an ordinary <img>, and a
    // URL somewhere else must never be fetched with the user's token.
    expect(isAttachmentUrl(url)).toBe(false)
  })
})

describe('attachmentMarkdown', () => {
  it('embeds an image', () => {
    expect(
      attachmentMarkdown({
        filename: 'shot.png',
        url: '/attachments/3/content',
        is_image: true,
      }),
    ).toBe('![shot.png](/attachments/3/content)')
  })

  it('links to anything that is not an image', () => {
    expect(
      attachmentMarkdown({
        filename: 'server.log',
        url: '/attachments/4/content',
        is_image: false,
      }),
    ).toBe('[server.log](/attachments/4/content)')
  })

  it('strips brackets out of the label', () => {
    // A ] in the name would close the link text early and leave the rest of
    // the filename sitting in the page as prose.
    expect(
      attachmentMarkdown({
        filename: 'log [2024].txt',
        url: '/attachments/5/content',
        is_image: false,
      }),
    ).toBe('[log 2024.txt](/attachments/5/content)')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 kB'],
    [1536, '2 kB'],
    [1024 * 1024, '1.0 MB'],
    [2_411_724, '2.3 MB'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})
