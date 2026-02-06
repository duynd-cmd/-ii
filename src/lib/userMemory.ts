export type ActiveView = 'pdf' | 'chat';

export interface UserPreferences {
  activeView: ActiveView;
  lastVisitedPage: number;
}

export interface UserSettings {
  autoFocusInput: boolean;
}

export interface UserLongTermMemory {
  version: 1;
  preferences: UserPreferences;
  previousPrompts: string[];
  settings: UserSettings;
  updatedAt: string;
}

export interface UserSessionMemory {
  draftPrompt: string;
  updatedAt: string;
}

const LONG_TERM_PREFIX = 'pdf-chat-memory';
const SESSION_PREFIX = 'pdf-chat-session';
const MAX_PROMPTS = 20;

const DEFAULT_LONG_TERM_MEMORY: UserLongTermMemory = {
  version: 1,
  preferences: {
    activeView: 'pdf',
    lastVisitedPage: 1,
  },
  previousPrompts: [],
  settings: {
    autoFocusInput: true,
  },
  updatedAt: new Date(0).toISOString(),
};

const DEFAULT_SESSION_MEMORY: UserSessionMemory = {
  draftPrompt: '',
  updatedAt: new Date(0).toISOString(),
};

function hasBrowserStorage() {
  return typeof window !== 'undefined' && !!window.localStorage && !!window.sessionStorage;
}

function getLongTermKey(userId: string, documentId: string) {
  return `${LONG_TERM_PREFIX}:${userId}:${documentId}`;
}

function getSessionKey(userId: string, documentId: string) {
  return `${SESSION_PREFIX}:${userId}:${documentId}`;
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('Failed to parse memory payload:', error);
    return null;
  }
}

function sanitizePrompts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_PROMPTS);
}

function sanitizeLongTermMemory(value: unknown): UserLongTermMemory {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_LONG_TERM_MEMORY };
  }

  const raw = value as Partial<UserLongTermMemory> & {
    preferences?: Partial<UserPreferences>;
    settings?: Partial<UserSettings>;
  };

  const activeView = raw.preferences?.activeView === 'chat' ? 'chat' : 'pdf';

  const rawPage = Number(raw.preferences?.lastVisitedPage);
  const lastVisitedPage = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const autoFocusInput = typeof raw.settings?.autoFocusInput === 'boolean'
    ? raw.settings.autoFocusInput
    : true;

  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString();

  return {
    version: 1,
    preferences: {
      activeView,
      lastVisitedPage,
    },
    previousPrompts: sanitizePrompts(raw.previousPrompts),
    settings: {
      autoFocusInput,
    },
    updatedAt,
  };
}

function sanitizeSessionMemory(value: unknown): UserSessionMemory {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SESSION_MEMORY };
  }

  const raw = value as Partial<UserSessionMemory>;

  return {
    draftPrompt: typeof raw.draftPrompt === 'string' ? raw.draftPrompt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

export function loadLongTermMemory(userId: string, documentId: string): UserLongTermMemory {
  if (!hasBrowserStorage()) return { ...DEFAULT_LONG_TERM_MEMORY };

  const parsed = safeJsonParse<unknown>(window.localStorage.getItem(getLongTermKey(userId, documentId)));
  return sanitizeLongTermMemory(parsed);
}

export function saveLongTermMemory(userId: string, documentId: string, memory: UserLongTermMemory): void {
  if (!hasBrowserStorage()) return;

  try {
    const payload: UserLongTermMemory = {
      ...sanitizeLongTermMemory(memory),
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(getLongTermKey(userId, documentId), JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save long-term memory:', error);
  }
}

export function loadSessionMemory(userId: string, documentId: string): UserSessionMemory {
  if (!hasBrowserStorage()) return { ...DEFAULT_SESSION_MEMORY };

  const parsed = safeJsonParse<unknown>(window.sessionStorage.getItem(getSessionKey(userId, documentId)));
  return sanitizeSessionMemory(parsed);
}

export function saveSessionMemory(userId: string, documentId: string, memory: UserSessionMemory): void {
  if (!hasBrowserStorage()) return;

  try {
    const payload: UserSessionMemory = {
      ...sanitizeSessionMemory(memory),
      updatedAt: new Date().toISOString(),
    };

    window.sessionStorage.setItem(getSessionKey(userId, documentId), JSON.stringify(payload));
  } catch (error) {
    console.error('Failed to save session memory:', error);
  }
}

export function updatePromptMemory(
  existingPrompts: string[],
  newPrompt: string,
): string[] {
  const normalizedPrompt = newPrompt.trim();
  if (!normalizedPrompt) return sanitizePrompts(existingPrompts);

  const next = [normalizedPrompt, ...sanitizePrompts(existingPrompts).filter((prompt) => prompt !== normalizedPrompt)];
  return next.slice(0, MAX_PROMPTS);
}
