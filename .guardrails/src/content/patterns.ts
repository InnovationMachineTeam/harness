// Реестр паттернов контентного сканера Guardrails. Реализация собственная;
// классы угроз согласованы с threat-model (см. SOURCES.md).
// Паттерн находит класс данных, но никогда не включает совпавший текст
// в результаты: находка несёт только id, подпись и число вхождений.

export type Surface = "write" | "prompt" | "tool-output" | "llm-io";
export type PatternSeverity = "low" | "medium" | "high" | "critical";

export interface ContentPattern {
  /** Стабильный id находки, например "secret.aws-access-key". */
  id: string;
  /** Подпись замены: [REDACTED:<label>]. */
  label: string;
  title: string;
  severity: PatternSeverity;
  /** Поверхности, на которых паттерн применяется. */
  surfaces: Surface[];
  regex: RegExp;
  /** Дополнительная проверка кандидата (контрольная сумма, форма). */
  validate?: (candidate: string) => boolean;
}

/** Инъекции инструкций в промпт, документ или вывод инструмента. */
const INJECTION: ContentPattern[] = [
  {
    id: "inj.markup-directive", label: "injection", title: "Директива в служебной разметке", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /<\/?\s*(?:system|instructions?|context|config|override|prompt)\s*>/gi,
  },
  {
    id: "inj.override-verbs", label: "injection", title: "Отмена инструкций", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\b(?:ignore|disregard|forget|discard|bypass|override)\b[^.\n]{0,60}\b(?:instructions?|directives?|guidelines?|rules?|constraints?|system\s*prompt)\b/gi,
  },
  {
    id: "inj.override-ru", label: "injection", title: "Отмена инструкций (русский)", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /(?<![\p{L}])(?:игнорир(?:уй|овать|уйте)|забудь|проигнорируй|отмени)[^.\n]{0,60}(?:инструкци[\p{L}]*|правил[\p{L}]*|ограничени[\p{L}]*|указани[\p{L}]*|системн[\p{L}]+\s+промпт[\p{L}]*)(?![\p{L}])/giu,
  },
  {
    id: "inj.override-multilingual", label: "injection", title: "Отмена инструкций (европейские языки)", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\b(?:ignorar?|olvida|desactiva[r]?)\b[^.\n]{0,60}\b(?:instrucciones|instrucció|directrices|reglas?)\b|\b(?:oublie[sz]?)\b[^.\n]{0,60}\b(?:instructions?|règles?|konsignes?)\b|\b(?:vergiss(?:t|en)?|ignorier(?:e|en)?)\b[^.\n]{0,60}\b(?:anweisungen|instructions?|regeln?)\b/gi,
  },
  {
    id: "inj.override-pt-it", label: "injection", title: "Отмена инструкций (португальский, итальянский)", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\b(?:ignor[ae]|desconsidere|desobede[çc]a)\b[^.\n]{0,60}\b(?:instru[çc][õo]es|regras|diretrizes)\b|\b(?:ignora(?:re)?|trascurare|disobedisci)\b[^.\n]{0,60}\b(?:istruzioni|regole|direttive)\b/gi,
  },
  {
    id: "inj.role-reassign", label: "injection", title: "Назначение новой роли", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\byou\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|unfiltered|uncensored|unbound|jailbroken)\b|\byour\s+(?:new|only|primary|sole)\s+(?:role|task|directive|purpose|instruction)\b/gi,
  },
  {
    id: "inj.fake-turn", label: "injection", title: "Поддельный ход диалога", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /(?:^|\n)\s{0,12}(?:assistant|system)\s*:[^\n]{0,200}\b(?:directive|instruction|comply|override|unrestricted|restrict)\b/gi,
  },
  {
    id: "inj.internal-directive", label: "injection", title: "Скрытая внутренняя директива", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\[\s*(?:internal|hidden|system)\s+(?:directive|instruction|command)\s*\]|\b(?:internal|hidden|system)[\s_-]+(?:directive|instruction|command)\b/gi,
  },
  {
    id: "inj.new-directive", label: "injection", title: "Новая директива или обновление системы", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\bnew\s+(?:directive|instruction)\b|\bsystem\s+update\b|\bpriority\s+override\b|\bsupersedes?\b[^.\n]{0,30}\b(?:instructions?|rules?|policies?)\b/gi,
  },
  {
    id: "inj.safety-disable", label: "injection", title: "Отключение защит", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\b(?:disable|bypass|turn\s+off|remove)\b[^.\n]{0,30}\b(?:safety|safeguards?|filters?|guardrails?|moderation|policies?)\b|\b(?:safety|filters?|guardrails?|moderation)\b[^.\n]{0,30}\b(?:disabled|removed)\b/gi,
  },
  {
    id: "inj.privilege-claim", label: "injection", title: "Заявка на привилегии", severity: "medium",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\badmin\s+(?:override|mode|access)\b|\broot\s+access\b|\belevated\s+privileges?\b|\bdeveloper\s+mode\b/gi,
  },
  {
    id: "inj.system-prompt-exfil", label: "injection", title: "Извлечение системного промпта", severity: "high",
    surfaces: ["prompt", "tool-output", "llm-io"],
    regex: /\b(?:output|print|reveal|repeat|show|dump|spell)\b[^.\n]{0,40}\b(?:full\s+|entire\s+|complete\s+)?system\s+prompt\b|\bsystem\s+prompt\s+verbatim\b/gi,
  },
  {
    id: "inj.policy-pretext", label: "injection", title: "Предлог политикой вызов инструмента", severity: "high",
    surfaces: ["tool-output", "llm-io"],
    regex: /\bpolic(?:y|ies)\b[^.\n]{0,120}\b(?:look\s?up|retrieve|fetch|call|run)\b|(?<![\p{L}])политик[\p{L}]*[^.\n]{0,120}\b(?:retrieve|fetch|call|look\s?up|извлеки|вызови|получи)\b/giu,
  },
  {
    id: "inj.authority-pretext", label: "injection", title: "Ссылка на авторитет для вызова инструмента", severity: "high",
    surfaces: ["tool-output", "llm-io"],
    regex: /\b(?:management|leadership|security\s+team|it\s+department|admin(?:istrator)?s?)\b[^.\n]{0,80}\b(?:requested|ordered|instructed|authorized|authorised)\b[^.\n]{0,80}\b(?:look\s?up|retrieve|fetch|call|run|output|reveal)\b/gi,
  },
];

// Секреты и ключи. Форматы токенов провайдеров - публичные факты о форме
// значений; регулярные выражения написаны самостоятельно.
const SECRETS: ContentPattern[] = [
  {
    id: "secret.private-key", label: "private-key", title: "Приватный ключ", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /-----BEGIN\s[A-Z\s]*PRIVATE\s(?:KEY|BLOCK)-----|PuTTY-User-Key-File-\d/g,
  },
  {
    id: "secret.aws-access-key", label: "aws-access-key", title: "Ключ доступа AWS", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "secret.aws-secret-assignment", label: "aws-secret-key", title: "Присвоение aws_secret_access_key", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\baws_secret_access_key\b\s*[:=]\s*["']?[A-Za-z0-9/+]{32,}/gi,
  },
  {
    id: "secret.github-token", label: "github-token", title: "Токен GitHub", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  },
  {
    id: "secret.openai-style-key", label: "api-key", title: "Ключ вида sk- (OpenAI-совместимые)", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "secret.google-api-key", label: "google-api-key", title: "Ключ Google API", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "secret.slack-token", label: "slack-token", title: "Токен Slack", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "secret.stripe-key", label: "stripe-key", title: "Ключ Stripe", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "secret.npm-token", label: "npm-token", title: "Токен npm", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: "secret.gitlab-token", label: "gitlab-token", title: "Токен GitLab", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "secret.telegram-bot-token", label: "telegram-bot-token", title: "Токен бота Telegram", severity: "high",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g,
  },
  {
    id: "secret.sendgrid-key", label: "sendgrid-key", title: "Ключ SendGrid", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    id: "secret.huggingface-token", label: "huggingface-token", title: "Токен Hugging Face", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bhf_[A-Za-z0-9]{34,}\b/g,
  },
  {
    id: "secret.groq-key", label: "groq-key", title: "Ключ Groq", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bgsk_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "secret.digitalocean-token", label: "digitalocean-token", title: "Токен DigitalOcean", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bdop_v1_[a-f0-9]{64}\b/g,
  },
  {
    id: "secret.google-oauth", label: "google-oauth", title: "Токен Google OAuth", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "secret.google-client-secret", label: "google-client-secret", title: "Секрет клиента Google OAuth", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "secret.twilio-key", label: "twilio-key", title: "Ключ Twilio", severity: "high",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bSK[0-9a-fA-F]{32}\b/g,
  },
  {
    id: "secret.pypi-token", label: "pypi-token", title: "Токен PyPI", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g,
  },
  {
    id: "secret.vault-token", label: "vault-token", title: "Токен HashiCorp Vault", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\b(?:hvs|hvb)\.[A-Za-z0-9_-]{24,}\b|\bs\.[A-Za-z0-9_-]{28,}\b/g,
  },
  {
    id: "secret.slack-webhook", label: "slack-webhook", title: "Webhook Slack", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\bhttps:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_/]+/g,
  },
  {
    id: "secret.jwt", label: "jwt", title: "JWT", severity: "high",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "secret.connection-string", label: "connection-string", title: "Строка подключения с паролем", severity: "critical",
    surfaces: ["write", "tool-output", "llm-io"],
    regex: /\b[a-z][a-z0-9+.-]{1,30}:\/\/[^\s:/@]{1,64}:[^\s@/]{6,}@/gi,
  },
];

// Персональные данные. Идентификаторы РФ требуют ключевого слова или
// контрольной суммы - голые последовательности цифр дают ложные срабатывания.
const PII: ContentPattern[] = [
  {
    id: "pii.email", label: "email", title: "Адрес электронной почты", severity: "medium",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    id: "pii.phone", label: "phone", title: "Номер телефона", severity: "medium",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /(?<!\d)(?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}(?!\d)|\+\d{1,3}[\s\-.]?\d{2,3}[\s\-.]?\d{3}[\s\-.]?\d{3,4}\b/g,
  },
  {
    id: "pii.card", label: "card", title: "Номер банковской карты", severity: "high",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhn,
  },
  {
    id: "pii.ssn-us", label: "ssn", title: "Номер соцстрахования США", severity: "high",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  {
    id: "pii.inn", label: "inn", title: "ИНН", severity: "medium",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /(?<![\p{L}])ИНН\s*[:#]?\s*(\d{10}|\d{12})(?!\d)/gu,
    validate: inn,
  },
  {
    id: "pii.snils", label: "snils", title: "СНИЛС", severity: "medium",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /(?<![\p{L}])СНИЛС\s*[:#]?\s*\d{3}-\d{3}-\d{3}\s?\d{2}(?!\d)/gu,
    validate: snils,
  },
  {
    id: "pii.passport-ru", label: "passport", title: "Паспорт РФ", severity: "high",
    surfaces: ["write", "prompt", "tool-output", "llm-io"],
    regex: /(?<![\p{L}])(?:паспорт|passport)[^.\n]{0,20}\d{2}\s?\d{2}\s?\d{6}(?!\d)/giu,
  },
  {
    id: "pii.credential-assignment", label: "credential", title: "Присвоение секретного значения в коде", severity: "high",
    surfaces: ["write", "llm-io"],
    regex: /\b(?:api[_-]?key|apikey|secret|secret[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|pwd|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["'][^"'\n]{16,}["']/gi,
  },
];

// Маркеры конфиденциальности. Не доказательство утечки, но сигнал для
// предупреждения перед отправкой текста в модель.
const MARKERS: ContentPattern[] = [
  {
    id: "marker.confidential", label: "confidential", title: "Маркер конфиденциальности", severity: "medium",
    surfaces: ["prompt", "llm-io"],
    regex: /(?<![\p{L}])(?:коммерческ[\p{L}]*\s+тайн[\p{L}]*|конфиденциальн[\p{L}]*|не\s+для\s+распространения|confidential|internal\s+only|trade\s+secret)(?![\p{L}])/giu,
  },
  {
    id: "marker.internal-host", label: "internal-host", title: "Внутреннее доменное имя", severity: "low",
    surfaces: ["prompt", "llm-io"],
    regex: /\b[A-Za-z0-9-]+(?:\.(?:internal|corp|local|intranet))\b/gi,
  },
];

export const CONTENT_PATTERNS: ContentPattern[] = [...INJECTION, ...SECRETS, ...PII, ...MARKERS];

// Валидация при загрузке модуля: битая запись валит загрузку, а не тихо
// пропускается и не становится невидимым пропуском сканера.
for (const [index, pattern] of CONTENT_PATTERNS.entries()) {
  if (CONTENT_PATTERNS.some((other, otherIndex) => otherIndex > index && other.id === pattern.id)) {
    throw new Error(`patterns: дубликат id ${pattern.id}`);
  }
  try {
    new RegExp(pattern.regex.source, pattern.regex.flags);
  } catch (error) {
    throw new Error(`patterns: некорректное выражение у ${pattern.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const knownSurfaces: Surface[] = ["write", "prompt", "tool-output", "llm-io"];
  for (const surface of pattern.surfaces) {
    if (!knownSurfaces.includes(surface)) throw new Error(`patterns: неизвестная поверхность "${surface}" у ${pattern.id}`);
  }
}

export function patternsFor(surface: Surface): ContentPattern[] {
  return CONTENT_PATTERNS.filter((pattern) => pattern.surfaces.includes(surface));
}

/** Контрольная сумма Луна для номеров карт. */
export function luhn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Контрольное число ИНН (10 и 12 знаков). */
export function inn(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  const weights10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
  const weights11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const weights12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
  const checksum = (source: string, weights: number[]): number => {
    let sum = 0;
    for (let index = 0; index < weights.length; index++) sum += Number(source[index]) * weights[index];
    return (sum % 11) % 10;
  };
  if (digits.length === 10) return checksum(digits, weights10) === Number(digits[9]);
  if (digits.length === 12) return checksum(digits, weights11) === Number(digits[10]) && checksum(digits, weights12) === Number(digits[11]);
  return false;
}

/** Контрольное число СНИЛС: позиции цифр считаются справа (1..9); сумма меньше 100 равна контролю, 100 и 101 дают 0, больше 101 - остаток от деления на 101 (остаток 100 даёт 0). */
export function snils(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  let sum = 0;
  for (let index = 0; index < 9; index++) sum += Number(digits[index]) * (9 - index);
  const control = sum < 100 ? sum : sum === 100 || sum === 101 ? 0 : sum % 101 === 100 ? 0 : sum % 101;
  return control === Number(digits.slice(9));
}
