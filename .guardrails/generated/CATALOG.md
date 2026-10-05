# Каталог Guardrails

Этот файл генерируется из `.guardrails/src/rules.ts`.

| ID | Эффект | Критичность | Категория | Тесты |
|---|---|---|---|---:|
| `shell.rm-rf-root` | block | critical | filesystem | 3 |
| `shell.rm-rf-worktree` | block | high | filesystem | 3 |
| `shell.rm-rf-outside-allowlist` | block | high | filesystem | 3 |
| `shell.git-force-push` | block | critical | git | 3 |
| `shell.git-push` | block | critical | git | 3 |
| `shell.history-rewrite` | block | critical | git | 3 |
| `shell.chmod-777` | block | high | filesystem | 3 |
| `db.drop` | block | critical | database | 3 |
| `db.delete-without-where` | block | critical | database | 3 |
| `prisma.reset` | block | high | database | 3 |
| `secrets.read` | block | critical | secrets | 3 |
| `secrets.read-tool` | block | critical | secrets | 3 |
| `net.pipe-to-shell` | block | critical | supply-chain | 3 |
| `write.secret-path` | block | critical | secrets | 3 |
| `write.protected-path` | block | high | integrity | 3 |
| `infra.production` | block | critical | infrastructure | 3 |
| `deploy.prod-apply` | block | critical | deployment | 3 |
| `deploy.destructive` | block | critical | deployment | 3 |
| `gate.answer-by-agent` | block | critical | approval | 3 |
| `approval.by-agent` | block | critical | approval | 3 |
| `structural.guard-mutation` | block | critical | governance | 3 |
| `deploy.billable` | warn | high | cost | 3 |
| `shell.git-hard-reset` | warn | high | git | 3 |
| `shell.git-clean` | warn | high | git | 3 |
| `shell.sudo` | warn | medium | host | 3 |
| `structural.agents-mutation` | warn | high | governance | 3 |
| `shell.credential-dump` | block | critical | secrets | 3 |
| `content.write-secret-value` | block | critical | secrets | 3 |
| `content.write-pii` | warn | medium | privacy | 3 |
| `content.write-credential` | warn | high | secrets | 3 |
| `prompt.injection` | block | critical | prompt-injection | 3 |
| `tooloutput.injection` | block | high | prompt-injection | 3 |
| `prompt.confidential-marker` | warn | medium | privacy | 3 |
