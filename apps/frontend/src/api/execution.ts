export type ExecutionLanguage = 'javascript' | 'python'

export interface ExecuteCodeRequest {
  code: string
  language: ExecutionLanguage
}

export interface ExecuteCodeResponse {
  jobId: string
}

export type ExecutionJobStatus = 'waiting' | 'active' | 'completed' | 'failed'

export interface ExecutionCodeResult {
  stdout: string
  stderr: string
  error: string | null
}

export interface ExecutionResultResponse {
  jobId: string
  status: ExecutionJobStatus
  result?: ExecutionCodeResult | null
  error?: string
}

const normalizeBaseUrl = (rawValue: string): string => {
  return rawValue.trim().replace(/\/$/, '')
}

const buildEndpoint = (baseUrl: string, path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  if (normalizedBaseUrl.length === 0) {
    return normalizedPath
  }

  return `${normalizedBaseUrl}${normalizedPath}`
}

const parseErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: unknown }

    if (typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message
    }
  } catch {
    // Ignore malformed error payloads.
  }

  return `Request failed with status ${response.status}`
}

const sleep = async (durationMs: number, signal?: AbortSignal): Promise<void> => {
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs)
    })

    return
  }

  if (signal.aborted) {
    throw new Error('Request was cancelled')
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)

    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(new Error('Request was cancelled'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const enqueueExecution = async (
  baseUrl: string,
  payload: ExecuteCodeRequest,
  signal?: AbortSignal,
): Promise<ExecuteCodeResponse> => {
  const response = await fetch(buildEndpoint(baseUrl, '/execute'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  const body = (await response.json()) as Partial<ExecuteCodeResponse>

  if (typeof body.jobId !== 'string' || body.jobId.trim().length === 0) {
    throw new Error('Execution service returned an invalid jobId')
  }

  return {
    jobId: body.jobId,
  }
}

export const getExecutionResult = async (
  baseUrl: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<ExecutionResultResponse> => {
  const response = await fetch(buildEndpoint(baseUrl, `/result/${jobId}`), {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response))
  }

  return (await response.json()) as ExecutionResultResponse
}

export const waitForExecutionResult = async (
  baseUrl: string,
  jobId: string,
  signal?: AbortSignal,
): Promise<ExecutionResultResponse> => {
  while (true) {
    const response = await getExecutionResult(baseUrl, jobId, signal)

    if (response.status === 'completed' || response.status === 'failed') {
      return response
    }

    await sleep(1_000, signal)
  }
}
