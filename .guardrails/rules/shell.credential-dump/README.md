# shell.credential-dump

Блокирует команды, выгружающие секреты окружения и хранилищ учётных данных в transcript: печать env в pipe, токены gh/gcloud, aws configure get, секреты kubectl/vault/doppler/1Password, keychain macOS.

**Действие:** block. **Критичность:** critical.

**Исправление:** Запросите у пользователя конкретное значение или используйте переменную окружения напрямую в команде без вывода.
