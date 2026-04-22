import { useEffect, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '../../store/settings';
import { getAiToken, setAiToken, deleteAiToken } from '../../ipc';
import { register } from '../registry';

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

const MODELS_ENDPOINT = '/models';

/**
 * Settings section for the AI assistant.
 *
 * Non-secret config (baseUrl, model, streaming) lives in `useSettingsStore`
 * and is persisted to `settings.json` via that store. The API token is stored
 * only in the OS keychain via `ipc.ts` (`getAiToken` / `setAiToken` /
 * `deleteAiToken`) — it is held as local component state here and is never
 * written to the Zustand store or disk.
 *
 * The "Test Connection" button hits the configured base URL's `/models`
 * endpoint directly — the AIProvider layer is deliberately not imported here
 * to keep this section self-contained.
 */
export function AISettingsSection() {
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const setAIConfig = useSettingsStore((s) => s.setAIConfig);

  const [apiToken, setApiToken] = useState('');
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [status, setStatus] = useState<TestStatus>({ kind: 'idle' });

  // Hydrate the token from the OS keychain on mount.
  useEffect(() => {
    let cancelled = false;
    getAiToken()
      .then((token) => {
        if (cancelled) return;
        setApiToken(token ?? '');
        setTokenLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Failed to load AI token from keychain', err);
        setTokenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist token changes straight to the keychain. Empty string deletes the
  // entry so stale tokens don't linger when the user clears the field.
  const handleTokenChange = async (next: string) => {
    setApiToken(next);
    setAIConfig({ apiToken: next }); // keep in-memory store in sync so AIService picks it up immediately
    setStatus({ kind: 'idle' });
    try {
      if (next) {
        await setAiToken(next);
      } else {
        await deleteAiToken();
      }
    } catch (err) {
      console.warn('Failed to write AI token to keychain', err);
    }
  };

  const handleTest = async () => {
    if (!aiConfig.baseUrl || !apiToken) {
      setStatus({ kind: 'error', message: 'Base URL and API Token are required.' });
      return;
    }
    setStatus({ kind: 'running' });
    try {
      const url = joinUrl(aiConfig.baseUrl, MODELS_ENDPOINT);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const message = body
          ? `HTTP ${res.status}: ${truncate(body, 200)}`
          : `HTTP ${res.status}`;
        setStatus({ kind: 'error', message });
        return;
      }
      setStatus({ kind: 'success' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div style={containerStyle}>
      <h2 style={headingStyle}>AI Assistant</h2>
      <p style={descStyle}>
        Configure an OpenAI-compatible API for the AI chat panel. Works with OpenAI,
        Anthropic (via compatible gateway), Ollama, and other compatible providers.
      </p>

      <Field label="Base URL" hint="OpenAI-compatible endpoint">
        <input
          type="text"
          value={aiConfig.baseUrl}
          placeholder="https://api.openai.com/v1"
          onChange={(e) => {
            setAIConfig({ baseUrl: e.target.value });
            setStatus({ kind: 'idle' });
          }}
          style={inputStyle}
        />
      </Field>

      <Field label="API Token" hint="Stored securely in the OS keychain">
        <input
          type="password"
          value={apiToken}
          placeholder={tokenLoaded ? 'sk-…' : 'Loading…'}
          disabled={!tokenLoaded}
          onChange={(e) => {
            void handleTokenChange(e.target.value);
          }}
          style={inputStyle}
          autoComplete="off"
        />
      </Field>

      <Field label="Model" hint="Model name passed to the API">
        <input
          type="text"
          value={aiConfig.model}
          placeholder="gpt-4o"
          onChange={(e) => {
            setAIConfig({ model: e.target.value });
            setStatus({ kind: 'idle' });
          }}
          style={inputStyle}
        />
      </Field>

      <Field label="Streaming" hint="Show responses word-by-word as they arrive">
        <label style={toggleRowStyle}>
          <input
            type="checkbox"
            checked={aiConfig.streaming}
            onChange={(e) => setAIConfig({ streaming: e.target.checked })}
          />
          <span style={{ fontSize: 13 }}>Stream responses</span>
        </label>
      </Field>

      <div style={testRowStyle}>
        <button
          type="button"
          onClick={handleTest}
          disabled={status.kind === 'running'}
          style={testButtonStyle(status.kind === 'running')}
        >
          {status.kind === 'running' ? 'Testing…' : 'Test Connection'}
        </button>
        {status.kind === 'success' && (
          <span style={successStyle}>✓ Connected</span>
        )}
        {status.kind === 'error' && (
          <span style={errorStyle} title={status.message}>
            ✕ {status.message}
          </span>
        )}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>
        <span style={labelTextStyle}>{label}</span>
        {hint && <span style={hintStyle}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const containerStyle: CSSProperties = {
  padding: 24,
  color: 'var(--fg)',
  maxWidth: 560,
};

const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const descStyle: CSSProperties = {
  margin: '4px 0 20px',
  color: 'var(--fg-dim)',
  fontSize: 12,
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 16,
};

const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
};

const labelTextStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--fg)',
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-dim)',
};

const inputStyle: CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--bg)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const toggleRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
  userSelect: 'none',
};

const testRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 8,
  flexWrap: 'wrap',
};

function testButtonStyle(disabled: boolean): CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 12,
    background: 'transparent',
    color: disabled ? 'var(--fg-dim)' : 'var(--accent)',
    border: `1px solid ${disabled ? 'var(--border)' : 'var(--accent)'}`,
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

const successStyle: CSSProperties = {
  color: 'var(--accent-green)',
  fontSize: 12,
};

const errorStyle: CSSProperties = {
  color: 'var(--accent-red)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 320,
};

register({ id: 'ai', label: 'AI Assistant', icon: '✨', component: AISettingsSection });
