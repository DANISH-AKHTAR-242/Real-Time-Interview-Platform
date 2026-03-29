import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { executionSecurityPolicy } from '../security/policy.js'

const MAX_TIMEOUT_MS = executionSecurityPolicy.maxExecutionTimeoutMs
const DEFAULT_TIMEOUT_MS = executionSecurityPolicy.maxExecutionTimeoutMs
const MAX_CAPTURED_OUTPUT_BYTES = executionSecurityPolicy.maxCapturedOutputBytes
const CPU_TIME_LIMIT_SECONDS = Math.ceil(executionSecurityPolicy.maxExecutionTimeoutMs / 1_000)

export interface RunDockerInput {
  code: string
  language: string
  timeoutMs?: number
}

export interface RunDockerResult {
  stdout: string
  stderr: string
  error: string | null
}

type SupportedLanguage = 'python' | 'javascript'

interface LanguageRuntime {
  image: string
  fileName: string
}

interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  spawnError: Error | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

interface OutputBuffer {
  value: string
  byteLength: number
  truncated: boolean
}

const LANGUAGE_RUNTIMES: Record<SupportedLanguage, LanguageRuntime> = {
  python: {
    image: 'code-runner-python',
    fileName: 'code.py',
  },
  javascript: {
    image: 'code-runner-javascript',
    fileName: 'code.js',
  },
}

const normalizeTimeoutMs = (rawTimeoutMs: number | undefined): number => {
  if (!Number.isFinite(rawTimeoutMs) || rawTimeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS
  }

  if (rawTimeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS
  }

  return Math.min(Math.trunc(rawTimeoutMs), MAX_TIMEOUT_MS)
}

const toDockerHostPath = (targetPath: string): string => {
  if (process.platform !== 'win32') {
    return targetPath
  }

  return targetPath.replace(/\\/g, '/')
}

const forceRemoveContainer = async (containerName: string): Promise<void> => {
  await new Promise<void>((resolve) => {
    const processHandle = spawn('docker', ['rm', '-f', containerName], {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    })

    processHandle.on('error', () => {
      resolve()
    })

    processHandle.on('close', () => {
      resolve()
    })
  })
}

const appendOutputChunk = (buffer: OutputBuffer, chunk: Buffer | string): void => {
  if (buffer.truncated) {
    return
  }

  const chunkValue = chunk.toString()
  const chunkByteLength = Buffer.byteLength(chunkValue, 'utf8')
  const availableBytes = MAX_CAPTURED_OUTPUT_BYTES - buffer.byteLength

  if (availableBytes <= 0) {
    buffer.truncated = true
    return
  }

  if (chunkByteLength <= availableBytes) {
    buffer.value += chunkValue
    buffer.byteLength += chunkByteLength
    return
  }

  const chunkBuffer = Buffer.from(chunkValue, 'utf8')
  buffer.value += chunkBuffer.subarray(0, availableBytes).toString('utf8')
  buffer.byteLength = MAX_CAPTURED_OUTPUT_BYTES
  buffer.truncated = true
}

const appendTruncationNotice = (stderr: string, processResult: ProcessResult): string => {
  const notices: string[] = []

  if (processResult.stdoutTruncated) {
    notices.push(`stdout truncated to ${MAX_CAPTURED_OUTPUT_BYTES} bytes`)
  }

  if (processResult.stderrTruncated) {
    notices.push(`stderr truncated to ${MAX_CAPTURED_OUTPUT_BYTES} bytes`)
  }

  if (notices.length === 0) {
    return stderr
  }

  return `${stderr}\n${notices.join('. ')}.`.trim()
}

const runProcessWithTimeout = async (
  args: string[],
  timeoutMs: number,
  containerName: string,
): Promise<ProcessResult> => {
  return await new Promise<ProcessResult>((resolve) => {
    const child = spawn('docker', args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutBuffer: OutputBuffer = {
      value: '',
      byteLength: 0,
      truncated: false,
    }

    const stderrBuffer: OutputBuffer = {
      value: '',
      byteLength: 0,
      truncated: false,
    }

    let timedOut = false
    let spawnError: Error | null = null

    child.stdout?.on('data', (chunk: Buffer | string) => {
      appendOutputChunk(stdoutBuffer, chunk)
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      appendOutputChunk(stderrBuffer, chunk)
    })

    const timeoutHandle = setTimeout(() => {
      timedOut = true

      try {
        child.kill('SIGKILL')
      } catch {
        // Ignore kill errors and rely on forced container cleanup.
      }

      void forceRemoveContainer(containerName)
    }, timeoutMs)

    timeoutHandle.unref()

    child.on('error', (error) => {
      spawnError = error
    })

    child.on('close', async (exitCode, signal) => {
      clearTimeout(timeoutHandle)

      if (timedOut) {
        await forceRemoveContainer(containerName)
      }

      resolve({
        stdout: stdoutBuffer.value,
        stderr: stderrBuffer.value,
        exitCode,
        signal,
        timedOut,
        spawnError,
        stdoutTruncated: stdoutBuffer.truncated,
        stderrTruncated: stderrBuffer.truncated,
      })
    })
  })
}

export const runDocker = async ({
  code,
  language,
  timeoutMs,
}: RunDockerInput): Promise<RunDockerResult> => {
  const normalizedLanguage = language.trim().toLowerCase() as SupportedLanguage
  const runtime = LANGUAGE_RUNTIMES[normalizedLanguage]

  if (!runtime) {
    return {
      stdout: '',
      stderr: `Unsupported language: ${language}`,
      error: 'UNSUPPORTED_LANGUAGE',
    }
  }

  const safeTimeoutMs = normalizeTimeoutMs(timeoutMs)
  const tempDir = await mkdtemp(path.join(tmpdir(), 'execution-service-'))
  const sourcePath = path.join(tempDir, runtime.fileName)
  const containerName = `execution-job-${randomUUID().replace(/-/g, '')}`

  try {
    await writeFile(sourcePath, code, {
      encoding: 'utf8',
      mode: 0o600,
    })

    const hostMountPath = toDockerHostPath(tempDir)

    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      containerName,
      `--memory=${executionSecurityPolicy.dockerMemoryLimitMb}m`,
      `--memory-swap=${executionSecurityPolicy.dockerMemoryLimitMb}m`,
      `--cpus=${executionSecurityPolicy.dockerCpuLimit}`,
      '--network=none',
      `--pids-limit=${executionSecurityPolicy.dockerMaxPids}`,
      '--ulimit',
      `cpu=${CPU_TIME_LIMIT_SECONDS}:${CPU_TIME_LIMIT_SECONDS}`,
      '--ulimit',
      `nproc=${executionSecurityPolicy.dockerMaxPids}:${executionSecurityPolicy.dockerMaxPids}`,
      '--ulimit',
      `nofile=${executionSecurityPolicy.dockerMaxOpenFiles}:${executionSecurityPolicy.dockerMaxOpenFiles}`,
      '--ulimit',
      `fsize=${executionSecurityPolicy.dockerMaxFileSizeBytes}:${executionSecurityPolicy.dockerMaxFileSizeBytes}`,
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      `/tmp:rw,noexec,nosuid,nodev,size=${executionSecurityPolicy.dockerTmpfsSizeMb}m`,
      '--user',
      '10001:10001',
      '-v',
      `${hostMountPath}:/app:ro`,
      '-w',
      '/app',
      runtime.image,
    ]

    const processResult = await runProcessWithTimeout(dockerArgs, safeTimeoutMs, containerName)
    const stderrWithTruncationNotice = appendTruncationNotice(processResult.stderr, processResult)

    if (processResult.spawnError) {
      return {
        stdout: processResult.stdout,
        stderr: `${stderrWithTruncationNotice}\n${processResult.spawnError.message}`.trim(),
        error: 'DOCKER_SPAWN_ERROR',
      }
    }

    if (processResult.timedOut) {
      return {
        stdout: processResult.stdout,
        stderr:
          `${stderrWithTruncationNotice}\nExecution timed out after ${safeTimeoutMs}ms.`.trim(),
        error: 'EXECUTION_TIMEOUT',
      }
    }

    if (processResult.exitCode !== 0) {
      return {
        stdout: processResult.stdout,
        stderr: stderrWithTruncationNotice,
        error:
          processResult.exitCode === null
            ? `CONTAINER_TERMINATED_BY_${processResult.signal ?? 'UNKNOWN_SIGNAL'}`
            : `CONTAINER_EXIT_${processResult.exitCode}`,
      }
    }

    return {
      stdout: processResult.stdout,
      stderr: stderrWithTruncationNotice,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown docker execution error'

    return {
      stdout: '',
      stderr: message,
      error: 'DOCKER_RUNTIME_ERROR',
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
