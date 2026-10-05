# Покрытие угроз

| Угроза | Правила |
|---|---|
| approval | `gate.answer-by-agent`, `approval.by-agent` |
| cost | `deploy.billable` |
| database | `db.drop`, `db.delete-without-where`, `prisma.reset` |
| deployment | `deploy.prod-apply`, `deploy.destructive` |
| filesystem | `shell.rm-rf-root`, `shell.rm-rf-worktree`, `shell.rm-rf-outside-allowlist`, `shell.chmod-777` |
| git | `shell.git-force-push`, `shell.git-push`, `shell.history-rewrite`, `shell.git-hard-reset`, `shell.git-clean` |
| governance | `structural.guard-mutation`, `structural.agents-mutation` |
| host | `shell.sudo` |
| infrastructure | `infra.production` |
| integrity | `write.protected-path` |
| privacy | `content.write-pii`, `prompt.confidential-marker` |
| prompt-injection | `prompt.injection`, `tooloutput.injection` |
| secrets | `secrets.read`, `secrets.read-tool`, `write.secret-path`, `shell.credential-dump`, `content.write-secret-value`, `content.write-credential` |
| supply-chain | `net.pipe-to-shell` |
