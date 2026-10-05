# Интеграции Guardrails

| Контекст | Тип | Источник | Failure mode |
|---|---|---|---|
| `runtime:claude:PreToolUse` | runtime-hook | `.claude/settings.json` | closed |
| `runtime:claude:UserPromptSubmit` | runtime-hook | `.claude/settings.json` | open |
| `runtime:claude:PostToolUse` | runtime-hook | `.claude/settings.json` | closed |
| `runtime:codex:PreToolUse` | runtime-hook | `.codex/hooks.json` | closed |
| `runtime:zcode:PreToolUse` | runtime-hook | `.zcode/config.json` | closed |
| `runtime:zcode:UserPromptSubmit` | runtime-hook | `.zcode/config.json` | open |
| `runtime:zcode:PostToolUse` | runtime-hook | `.zcode/config.json` | closed |
| `runtime:cursor:preToolUse` | runtime-hook | `.cursor/hooks.json` | closed |
| `runtime:kimi:PreToolUse` | runtime-hook | `.kimi/config.toml` | closed |
| `runtime:opencode:tool.execute.before` | runtime-hook | `.opencode/plugins/agentos-guard.ts` | closed |
| `runtime:opencode:tool.execute.after` | runtime-hook | `.opencode/plugins/agentos-guard.ts` | open |
| `code:console:run-command` | code | `apps/console/src/core/agentTools.ts` | closed |
| `code:console:lifecycle-hook` | code | `apps/console/src/core/lifecycleHooks.ts` | closed |
| `code:console:model-wrapper` | code | `apps/console/src/core/langchain/chatModel.ts` | closed |
| `git:husky:pre-commit` | git-hook | `.husky/pre-commit` | closed |
| `git:husky:content-scan` | git-hook | `.husky/pre-commit` | closed |
| `git:husky:pre-push` | git-hook | `.husky/pre-push` | closed |
| `verification:fast` | verification | `tooling/scripts/src/verify.ts` | closed |
| `ci:guardrails` | ci | `.github/workflows/guardrails.yml` | closed |
| `ci:guardrails:content-scan` | ci | `.github/workflows/guardrails.yml` | closed |
| `verification:security-content-scan` | verification | `tooling/scripts/src/verify.ts` | closed |
