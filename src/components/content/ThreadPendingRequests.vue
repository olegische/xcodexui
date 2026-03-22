<template>
  <section v-if="pendingRequests.length > 0" class="pending-composer">
    <article
      v-for="request in pendingRequests"
      :key="`server-request:${request.id}`"
      class="pending-shell"
      :class="{ 'pending-shell-dark': isDarkTheme }"
    >
      <div class="pending-copy">
        <p class="pending-eyebrow" :class="{ 'pending-eyebrow-dark': isDarkTheme }">{{ describeRequestKind(request) }}</p>
        <h2 class="pending-title" :class="{ 'pending-title-dark': isDarkTheme }">{{ describeRequestTitle(request) }}</h2>
        <p v-if="describeRequestBody(request)" class="pending-body" :class="{ 'pending-body-dark': isDarkTheme }">{{ describeRequestBody(request) }}</p>
        <p v-if="describeRequestMeta(request)" class="pending-meta" :class="{ 'pending-meta-dark': isDarkTheme }">{{ describeRequestMeta(request) }}</p>
      </div>

      <details v-if="formatRequestPayload(request)" class="pending-disclosure" :class="{ 'pending-disclosure-dark': isDarkTheme }">
        <summary class="pending-disclosure-summary" :class="{ 'pending-disclosure-summary-dark': isDarkTheme }">
          Request details
        </summary>
        <pre class="pending-disclosure-code" :class="{ 'pending-disclosure-code-dark': isDarkTheme }">{{ formatRequestPayload(request) }}</pre>
      </details>

      <section v-if="request.method === 'item/commandExecution/requestApproval'" class="pending-actions">
        <button type="button" class="pending-button pending-button-primary" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'accept')">Accept</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'acceptForSession')">Accept for Session</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'decline')">Decline</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'cancel')">Cancel</button>
      </section>

      <section v-else-if="request.method === 'item/fileChange/requestApproval'" class="pending-actions">
        <button type="button" class="pending-button pending-button-primary" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'accept')">Accept</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'acceptForSession')">Accept for Session</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'decline')">Decline</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondApproval(request.id, 'cancel')">Cancel</button>
      </section>

      <section v-else-if="request.method === 'item/browserTool/requestApproval'" class="pending-actions">
        <button type="button" class="pending-button pending-button-primary pending-button-browser-allow" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme, 'pending-button-browser-allow-dark': isDarkTheme }" @click="onRespondBrowserToolApproval(request.id, 'allow_once')">Allow once</button>
        <button type="button" class="pending-button pending-button-browser-allow-secondary" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-browser-allow-secondary-dark': isDarkTheme }" @click="onRespondBrowserToolApproval(request.id, 'allow_for_session')">Allow for session</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondBrowserToolApproval(request.id, 'deny')">Deny</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondBrowserToolApproval(request.id, 'abort')">Abort</button>
      </section>

      <section v-else-if="request.method === 'item/tool/requestUserInput'" class="pending-user-input">
        <div
          v-for="question in readToolQuestions(request)"
          :key="`${request.id}:${question.id}`"
          class="pending-question"
        >
          <p class="pending-question-title" :class="{ 'pending-question-title-dark': isDarkTheme }">{{ question.header || question.question }}</p>
          <p v-if="question.header && question.question" class="pending-question-text" :class="{ 'pending-question-text-dark': isDarkTheme }">{{ question.question }}</p>
          <select
            class="pending-select"
            :class="{ 'pending-field-dark': isDarkTheme }"
            :value="readQuestionAnswer(request.id, question.id, question.options[0] || '')"
            @change="onQuestionAnswerChange(request.id, question.id, $event)"
          >
            <option v-for="option in question.options" :key="`${request.id}:${question.id}:${option}`" :value="option">
              {{ option }}
            </option>
          </select>
          <input
            v-if="question.isOther"
            class="pending-input"
            :class="{ 'pending-field-dark': isDarkTheme }"
            type="text"
            :value="readQuestionOtherAnswer(request.id, question.id)"
            placeholder="Other answer"
            @input="onQuestionOtherAnswerInput(request.id, question.id, $event)"
          />
        </div>

        <button type="button" class="pending-button pending-button-primary pending-submit" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme }" @click="onRespondToolRequestUserInput(request)">
          Submit answers
        </button>
      </section>

      <section v-else-if="request.method === 'item/tool/call'" class="pending-actions">
        <button type="button" class="pending-button pending-button-primary" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme }" @click="onRespondToolCallFailure(request.id)">Fail tool call</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRespondToolCallSuccess(request.id)">Return empty success</button>
      </section>

      <section v-else class="pending-actions">
        <button type="button" class="pending-button pending-button-primary" :class="{ 'pending-button-dark': isDarkTheme, 'pending-button-primary-dark': isDarkTheme }" @click="onRespondEmptyResult(request.id)">Return empty result</button>
        <button type="button" class="pending-button" :class="{ 'pending-button-dark': isDarkTheme }" @click="onRejectUnknownRequest(request.id)">Reject request</button>
      </section>
    </article>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UiServerRequest } from '../../types/codex'

type ParsedToolQuestion = {
  id: string
  header: string
  question: string
  isOther: boolean
  options: string[]
}

type BrowserApprovalRequest = {
  canonicalToolName: string
  targetUrl: string | null
  targetOrigin: string | null
  reason: string
}

defineProps<{
  pendingRequests: UiServerRequest[]
}>()

const emit = defineEmits<{
  (event: 'respond-server-request', payload: { id: number; result?: unknown; error?: { code?: number; message: string } }): void
}>()

const toolQuestionAnswers = ref<Record<string, string>>({})
const toolQuestionOtherAnswers = ref<Record<string, string>>({})
const isDarkTheme = ref(false)
let themeObserver: MutationObserver | null = null

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatIsoTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function readRequestReason(request: UiServerRequest): string {
  const params = asRecord(request.params)
  const reason = params?.reason
  return typeof reason === 'string' ? reason.trim() : ''
}

function readBrowserApprovalRequest(request: UiServerRequest): BrowserApprovalRequest | null {
  const params = asRecord(request.params)
  const raw = asRecord(params?.request)
  if (!raw) return null
  return {
    canonicalToolName: readString(raw.canonicalToolName) || readString(raw.toolName),
    targetUrl: readString(raw.targetUrl) || null,
    targetOrigin: readString(raw.targetOrigin) || null,
    reason: readString(raw.reason),
  }
}

function describeRequestKind(request: UiServerRequest): string {
  if (request.method === 'item/browserTool/requestApproval') return 'Browser approval'
  if (request.method === 'item/tool/requestUserInput') return 'Input required'
  if (request.method === 'item/commandExecution/requestApproval') return 'Command approval'
  if (request.method === 'item/fileChange/requestApproval') return 'File change approval'
  if (request.method === 'item/tool/call') return 'Tool response required'
  return 'Action required'
}

function describeRequestTitle(request: UiServerRequest): string {
  if (request.method === 'item/browserTool/requestApproval') return 'Approve browser action'
  if (request.method === 'item/tool/requestUserInput') return 'Answer before the run can continue'
  if (request.method === 'item/commandExecution/requestApproval') return 'Approve command execution'
  if (request.method === 'item/fileChange/requestApproval') return 'Approve file change'
  if (request.method === 'item/tool/call') return 'Tool call is waiting for a result'
  return 'Review this request'
}

function describeRequestBody(request: UiServerRequest): string {
  if (request.method === 'item/browserTool/requestApproval') {
    const browserRequest = readBrowserApprovalRequest(request)
    if (!browserRequest) return readRequestReason(request)
    const summary = browserRequest.reason || 'The runtime needs approval before using a browser tool.'
    const toolName = browserRequest.canonicalToolName
    return toolName ? `${toolName}: ${summary}` : summary
  }

  const reason = readRequestReason(request)
  if (reason) return reason

  if (request.method === 'item/tool/requestUserInput') {
    return 'The agent needs an answer before it can continue.'
  }

  return ''
}

function describeRequestMeta(request: UiServerRequest): string {
  const time = formatIsoTime(request.receivedAtIso)

  if (request.method === 'item/browserTool/requestApproval') {
    const browserRequest = readBrowserApprovalRequest(request)
    const target = browserRequest?.targetUrl || browserRequest?.targetOrigin || ''
    if (target && time) return `${target} · ${time}`
    if (target) return target
    if (time) return `Requested at ${time}`
    return ''
  }

  return time ? `Requested at ${time}` : ''
}

function formatRequestPayload(request: UiServerRequest): string {
  if (request.params == null) return ''
  try {
    return JSON.stringify(request.params, null, 2)
  } catch {
    return String(request.params)
  }
}

function toolQuestionKey(requestId: number, questionId: string): string {
  return `${String(requestId)}:${questionId}`
}

function readToolQuestions(request: UiServerRequest): ParsedToolQuestion[] {
  const params = asRecord(request.params)
  const questions = Array.isArray(params?.questions) ? params.questions : []
  const parsed: ParsedToolQuestion[] = []

  for (const row of questions) {
    const question = asRecord(row)
    if (!question) continue
    const id = typeof question.id === 'string' ? question.id : ''
    if (!id) continue

    const options = Array.isArray(question.options)
      ? question.options
        .map((option) => asRecord(option))
        .map((option) => option?.label)
        .filter((option): option is string => typeof option === 'string' && option.length > 0)
      : []

    parsed.push({
      id,
      header: typeof question.header === 'string' ? question.header : '',
      question: typeof question.question === 'string' ? question.question : '',
      isOther: question.isOther === true,
      options,
    })
  }

  return parsed
}

function readQuestionAnswer(requestId: number, questionId: string, fallback: string): string {
  const key = toolQuestionKey(requestId, questionId)
  const saved = toolQuestionAnswers.value[key]
  if (typeof saved === 'string' && saved.length > 0) return saved
  return fallback
}

function readQuestionOtherAnswer(requestId: number, questionId: string): string {
  const key = toolQuestionKey(requestId, questionId)
  return toolQuestionOtherAnswers.value[key] ?? ''
}

function onQuestionAnswerChange(requestId: number, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionAnswers.value = {
    ...toolQuestionAnswers.value,
    [key]: target.value,
  }
}

function onQuestionOtherAnswerInput(requestId: number, questionId: string, event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  const key = toolQuestionKey(requestId, questionId)
  toolQuestionOtherAnswers.value = {
    ...toolQuestionOtherAnswers.value,
    [key]: target.value,
  }
}

function onRespondApproval(requestId: number, decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel'): void {
  emit('respond-server-request', {
    id: requestId,
    result: { decision },
  })
}

function onRespondBrowserToolApproval(
  requestId: number,
  decision: 'allow_once' | 'allow_for_session' | 'deny' | 'abort',
): void {
  emit('respond-server-request', {
    id: requestId,
    result: { decision },
  })
}

function onRespondToolRequestUserInput(request: UiServerRequest): void {
  const questions = readToolQuestions(request)
  const answers: Record<string, { answers: string[] }> = {}

  for (const question of questions) {
    const selected = readQuestionAnswer(request.id, question.id, question.options[0] || '')
    const other = readQuestionOtherAnswer(request.id, question.id).trim()
    const values = [selected, other].map((value) => value.trim()).filter((value) => value.length > 0)
    answers[question.id] = { answers: values }
  }

  emit('respond-server-request', {
    id: request.id,
    result: { answers },
  })
}

function onRespondToolCallFailure(requestId: number): void {
  emit('respond-server-request', {
    id: requestId,
    result: {
      success: false,
      contentItems: [
        {
          type: 'inputText',
          text: 'Tool call rejected from codex-web-local UI.',
        },
      ],
    },
  })
}

function onRespondToolCallSuccess(requestId: number): void {
  emit('respond-server-request', {
    id: requestId,
    result: {
      success: true,
      contentItems: [],
    },
  })
}

function onRespondEmptyResult(requestId: number): void {
  emit('respond-server-request', {
    id: requestId,
    result: {},
  })
}

function onRejectUnknownRequest(requestId: number): void {
  emit('respond-server-request', {
    id: requestId,
    error: {
      code: -32000,
      message: 'Rejected from codex-web-local UI.',
    },
  })
}

function syncThemeState(): void {
  isDarkTheme.value = document.documentElement.classList.contains('dark')
}

onMounted(() => {
  syncThemeState()
  themeObserver = new MutationObserver(() => {
    syncThemeState()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
})
</script>

<style scoped>
@reference "tailwindcss";

.pending-composer {
  @apply flex w-full max-w-175 flex-col gap-3 mx-auto px-2 sm:px-6;
}

.pending-shell {
  @apply rounded-2xl border border-zinc-300 bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm;
}

.pending-shell-dark {
  @apply border-neutral-700 bg-neutral-800 shadow-2xl shadow-black/30;
}

.pending-copy {
  @apply flex flex-col gap-1;
}

.pending-eyebrow {
  @apply m-0 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-zinc-500;
}

.pending-eyebrow-dark {
  @apply text-neutral-400;
}

.pending-title {
  @apply m-0 text-base font-semibold text-zinc-950;
}

.pending-title-dark {
  @apply text-neutral-50;
}

.pending-body {
  @apply m-0 text-sm leading-6 text-zinc-700 whitespace-pre-wrap break-words;
}

.pending-body-dark {
  @apply text-neutral-200;
}

.pending-meta {
  @apply m-0 text-xs leading-5 text-zinc-500 break-all;
}

.pending-meta-dark {
  @apply text-neutral-400;
}

.pending-actions {
  @apply mt-3 flex flex-wrap gap-2;
}

.pending-disclosure {
  @apply mt-3 rounded-xl border border-zinc-200 bg-zinc-50;
}

.pending-disclosure-dark {
  @apply border-neutral-700 bg-neutral-900/70;
}

.pending-disclosure-summary {
  @apply cursor-pointer list-none px-3 py-2 text-sm font-medium text-zinc-700;
}

.pending-disclosure-summary::-webkit-details-marker {
  display: none;
}

.pending-disclosure-summary-dark {
  @apply text-neutral-100;
}

.pending-disclosure-code {
  @apply m-0 max-h-56 overflow-auto border-t border-zinc-200 px-3 py-3 text-xs leading-6 text-zinc-700 whitespace-pre-wrap break-all;
}

.pending-disclosure-code-dark {
  @apply border-neutral-700 text-neutral-200;
}

.pending-button {
  @apply rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100;
}

.pending-button-dark {
  @apply border-neutral-700 bg-neutral-700 text-neutral-100 hover:bg-neutral-600;
}

.pending-button-primary {
  @apply border-zinc-900 bg-zinc-900 text-white hover:bg-black;
}

.pending-button-primary-dark {
  @apply border-neutral-200 bg-neutral-200 text-neutral-900 hover:bg-white;
}

.pending-button-browser-allow {
  @apply text-white;
  border-color: #cc241d;
  background-color: #cc241d;
}

.pending-button-browser-allow-dark {
  @apply text-white;
  border-color: #cc241d;
  background-color: #cc241d;
}

.pending-button-browser-allow:hover,
.pending-button-browser-allow-dark:hover {
  background-color: #9d0006;
}

.pending-button-browser-allow-secondary {
  @apply border-red-200 bg-red-50 text-red-800 hover:bg-red-100;
}

.pending-button-browser-allow-secondary-dark {
  @apply border-red-900 bg-red-950/60 text-red-100 hover:bg-red-950/80;
}

.pending-user-input {
  @apply mt-3 flex flex-col gap-3;
}

.pending-question {
  @apply flex flex-col gap-1.5;
}

.pending-question-title {
  @apply m-0 text-sm font-medium text-zinc-900;
}

.pending-question-title-dark {
  @apply text-neutral-100;
}

.pending-question-text {
  @apply m-0 text-xs text-zinc-500;
}

.pending-question-text-dark {
  @apply text-neutral-400;
}

.pending-select,
.pending-input {
  @apply h-10 rounded-xl border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400;
}

.pending-field-dark {
  @apply border-neutral-700 bg-neutral-700 text-neutral-100 placeholder:text-neutral-500;
}

.pending-submit {
  @apply self-start;
}
</style>
