import { executionSecurityPolicy, type AllowedExecutionLanguage } from '../security/policy.js'

export interface ExecuteRequestBody {
  code: string
  language: AllowedExecutionLanguage
}

const JOB_ID_PATTERN = /^[a-zA-Z0-9:_-]+$/
const ALLOWED_LANGUAGES = new Set<string>(executionSecurityPolicy.allowedLanguages)

export const parseExecuteRequestBody = (body: unknown): ExecuteRequestBody => {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body')
  }

  const { code, language } = body as Partial<ExecuteRequestBody>

  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('code must be a non-empty string')
  }

  const codeSizeBytes = Buffer.byteLength(code, 'utf8')

  if (codeSizeBytes > executionSecurityPolicy.maxCodeBytes) {
    throw new Error(`code exceeds ${executionSecurityPolicy.maxCodeBytes} bytes`)
  }

  if (typeof language !== 'string' || language.trim().length === 0) {
    throw new Error('language must be a non-empty string')
  }

  const normalizedLanguage = language.trim().toLowerCase()

  if (!ALLOWED_LANGUAGES.has(normalizedLanguage)) {
    throw new Error('language is not allowed')
  }

  return {
    code,
    language: normalizedLanguage as AllowedExecutionLanguage,
  }
}

export const parseJobIdParam = (jobId: unknown): string => {
  if (typeof jobId !== 'string') {
    throw new Error('jobId must be a string')
  }

  const normalized = jobId.trim()

  if (normalized.length === 0) {
    throw new Error('jobId must be a non-empty string')
  }

  if (normalized.length > 128) {
    throw new Error('jobId is too long')
  }

  if (!JOB_ID_PATTERN.test(normalized)) {
    throw new Error('jobId contains invalid characters')
  }

  return normalized
}
