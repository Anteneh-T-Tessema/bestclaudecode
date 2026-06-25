import { useState, useCallback } from 'react'
import { Wand2, FolderOpen, CheckCircle2, Loader2 } from 'lucide-react'
import { accent, border, fg, surface } from '../../design'
import { toast } from '../../store/useToastStore'

interface Framework {
  id: string
  label: string
  desc: string
}

const FRAMEWORKS: Framework[] = [
  { id: 'next', label: 'Next.js', desc: 'React full-stack framework with App Router' },
  { id: 'vite-react', label: 'Vite + React', desc: 'Fast React SPA with TypeScript' },
  { id: 'fastapi', label: 'FastAPI', desc: 'Python async REST API with OpenAPI docs' },
  { id: 'express', label: 'Express', desc: 'Minimal Node.js web server' },
]

export function ProjectWizardPanel() {
  const [framework, setFramework] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  const pickDir = useCallback(async () => {
    const dir = await window.api.fs.openDialog()
    if (dir) setTargetDir(dir)
  }, [])

  const create = useCallback(async () => {
    if (!framework || !projectName.trim() || !targetDir.trim()) {
      toast.error('Select a framework, enter a project name, and choose a directory.')
      return
    }
    setCreating(true)
    try {
      const result = await window.api.wizard.scaffold({ framework, projectName: projectName.trim(), targetDir: targetDir.trim() })
      if (result.success && result.projectPath) {
        setCreated(result.projectPath)
        toast.success(`Project created at ${result.projectPath}`)
      } else {
        toast.error(result.error ?? 'Scaffold failed')
      }
    } finally {
      setCreating(false)
    }
  }, [framework, projectName, targetDir])

  if (created) {
    return (
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <CheckCircle2 size={32} style={{ color: accent.green.fg }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: fg[0] }}>Project created!</div>
        <div style={{ fontSize: 10, color: fg[2], fontFamily: 'monospace', wordBreak: 'break-all' }}>{created}</div>
        <div style={{ fontSize: 11, color: fg[3] }}>Project path updated. Reload the Explorer to browse files.</div>
        <button
          type="button"
          onClick={() => { setCreated(null); setProjectName(''); setFramework(null) }}
          style={{
            marginTop: 8, fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
            background: accent.green.subtle, border: `1px solid ${accent.green.border}`, color: accent.green.fg,
          }}
        >
          Create Another
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Wand2 size={14} style={{ color: accent.green.fg }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: fg[0] }}>New Project</span>
      </div>

      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3], marginBottom: 8 }}>
          Framework
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {FRAMEWORKS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFramework(f.id)}
              style={{
                textAlign: 'left', padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                border: `1px solid ${framework === f.id ? accent.green.border : border[1]}`,
                background: framework === f.id ? accent.green.subtle : surface.raised,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: framework === f.id ? accent.green.fg : fg[0] }}>{f.label}</span>
              <span style={{ fontSize: 9, color: fg[3] }}>{f.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3], marginBottom: 6 }}>
          Project Name
        </div>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-app"
          style={{
            width: '100%', padding: '6px 8px', borderRadius: 5, fontSize: 11, color: fg[0],
            background: surface.raised, border: `1px solid ${border[1]}`, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: fg[3], marginBottom: 6 }}>
          Target Directory
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={targetDir}
            onChange={(e) => setTargetDir(e.target.value)}
            placeholder="/Users/me/projects"
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 5, fontSize: 11, color: fg[0],
              background: surface.raised, border: `1px solid ${border[1]}`, outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={pickDir}
            title="Browse"
            style={{
              display: 'flex', alignItems: 'center', padding: '0 8px', borderRadius: 5, cursor: 'pointer',
              background: surface.raised, border: `1px solid ${border[1]}`, color: fg[2],
            }}
          >
            <FolderOpen size={12} />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={create}
        disabled={creating || !framework || !projectName.trim() || !targetDir.trim()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
          background: accent.green.subtle, border: `1px solid ${accent.green.border}`,
          color: accent.green.fg, opacity: (creating || !framework || !projectName.trim() || !targetDir.trim()) ? 0.5 : 1,
        }}
      >
        {creating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={12} />}
        {creating ? 'Creating…' : 'Create Project'}
      </button>
    </div>
  )
}
