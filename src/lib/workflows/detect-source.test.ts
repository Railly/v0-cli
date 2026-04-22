import { describe, expect, it } from 'bun:test'
import { detectSourceKind, extractTemplateIdFromUrl } from './detect-source.ts'

describe('detectSourceKind', () => {
  describe('templates', () => {
    it('detects template_ prefix', () => {
      expect(detectSourceKind('template_nextjs-blog')).toBe('template')
      expect(detectSourceKind('tpl_foo')).toBe('template')
    })
    it('detects v0.app template URLs', () => {
      expect(
        detectSourceKind(
          'https://v0.app/templates/optimus-the-ai-platform-to-build-and-ship-LHv4frpA7Us',
        ),
      ).toBe('template')
    })
  })

  describe('extractTemplateIdFromUrl', () => {
    it('extracts id from the last dash segment', () => {
      expect(
        extractTemplateIdFromUrl(
          'https://v0.app/templates/optimus-the-ai-platform-to-build-and-ship-LHv4frpA7Us',
        ),
      ).toBe('LHv4frpA7Us')
    })
    it('handles trailing slash', () => {
      expect(
        extractTemplateIdFromUrl('https://v0.app/templates/foo-bar-XYZ123/'),
      ).toBe('XYZ123')
    })
    it('returns null for non-v0.app hosts', () => {
      expect(extractTemplateIdFromUrl('https://github.com/foo/bar')).toBeNull()
    })
    it('returns null for non-template paths', () => {
      expect(extractTemplateIdFromUrl('https://v0.app/chat/abc123')).toBeNull()
    })
    it('returns null for non-URLs', () => {
      expect(extractTemplateIdFromUrl('template_abc')).toBeNull()
      expect(extractTemplateIdFromUrl('./path')).toBeNull()
    })
  })

  describe('paths', () => {
    it('detects cwd literals', () => {
      expect(detectSourceKind('.')).toBe('files')
      expect(detectSourceKind('..')).toBe('files')
    })
    it('detects relative paths', () => {
      expect(detectSourceKind('./mi-proyecto')).toBe('files')
      expect(detectSourceKind('../sibling')).toBe('files')
    })
    it('detects home-relative paths', () => {
      expect(detectSourceKind('~/projects/x')).toBe('files')
    })
    it('detects absolute paths', () => {
      expect(detectSourceKind('/Users/hunter/code')).toBe('files')
    })
  })

  describe('git hosts', () => {
    it('detects github.com as repo', () => {
      expect(detectSourceKind('https://github.com/vercel/next.js')).toBe('repo')
    })
    it('detects gitlab.com as repo', () => {
      expect(detectSourceKind('https://gitlab.com/foo/bar')).toBe('repo')
    })
    it('detects bitbucket.org as repo', () => {
      expect(detectSourceKind('https://bitbucket.org/foo/bar')).toBe('repo')
    })
    it('detects SSH git remotes as repo', () => {
      expect(detectSourceKind('git@github.com:foo/bar.git')).toBe('repo')
    })
    it('detects .git suffix as repo', () => {
      expect(detectSourceKind('https://example.com/self-hosted/repo.git')).toBe('repo')
    })
  })

  describe('zip urls', () => {
    it('detects .zip suffix', () => {
      expect(detectSourceKind('https://example.com/dist.zip')).toBe('zip')
      expect(detectSourceKind('https://cdn.example.com/archive/v1.0.zip')).toBe('zip')
    })
  })

  describe('registry', () => {
    it('detects .json suffix on non-git host as registry', () => {
      expect(detectSourceKind('https://ui.shadcn.com/registry/button.json')).toBe(
        'registry',
      )
    })
  })

  describe('fallbacks', () => {
    it('defaults unknown HTTP url to repo', () => {
      expect(detectSourceKind('https://example.com/something')).toBe('repo')
    })
    it('defaults bare string to files', () => {
      expect(detectSourceKind('mi-proyecto')).toBe('files')
    })
    it('handles empty input', () => {
      expect(detectSourceKind('')).toBe('files')
    })
  })
})
