/**
 * Starter .lakoorapolicies.json templates for common compliance regimes — a
 * reasonable default a team can load into the policy editor and adjust,
 * rather than writing regex/glob patterns from scratch. Not legal advice or
 * a certification claim; these are starting points for the kinds of actions
 * each regime typically cares about.
 */
export interface PolicyConfig {
  block_commands: string[]
  block_paths: string[]
  require_approval_for: string[]
  /** Gap 142 loose end — optional since starter templates are compliance presets, not retry-budget opinions; the engine defaults to 3 when absent. */
  max_retries?: number
  /** Run tsc --noEmit on AI-generated .ts/.tsx files before writing to disk. */
  require_type_check?: boolean
  /** Block any single EDIT block whose line count exceeds this limit (0 = no limit). */
  max_edit_lines?: number
  /** Auto-reject pending-approval after this many minutes (0 = no timeout). */
  approval_timeout_minutes?: number
  /** Paths (globs) that trigger an inline security review on edit. */
  auto_review_paths?: string[]
}

export interface PolicyTemplate {
  id: string
  name: string
  description: string
  config: PolicyConfig
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: 'soc2',
    name: 'SOC 2',
    description: 'Blocks edits to credentials/secrets and requires approval before deploys or infra changes.',
    config: {
      block_commands: ['rm -rf /', 'curl.*\\|.*sh', 'chmod -R 777'],
      block_paths: ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'secrets/*'],
      require_approval_for: ['deploy', 'terraform apply', 'kubectl apply', 'push.*production'],
    },
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    description: 'Blocks destructive database commands and edits near PHI-shaped data; requires approval before migrations or bulk data changes.',
    config: {
      block_commands: ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE'],
      block_paths: ['.env', '*.pem', 'phi/*', 'patient-data/*'],
      require_approval_for: ['migrate', 'DELETE FROM', 'UPDATE .* SET', 'deploy'],
    },
  },
  {
    id: 'pci',
    name: 'PCI-DSS',
    description: 'Blocks edits to payment config and card-data-shaped files; requires approval before touching payment infrastructure.',
    config: {
      block_commands: ['DROP TABLE', 'rm -rf /'],
      block_paths: ['.env', '*.pem', 'payment-config/*', 'card-data/*'],
      require_approval_for: ['deploy', 'stripe', 'payment', 'push.*production'],
    },
  },
]
