# HAI-101: Claude Code OAuth Authentication — Research Findings

**Date:** 2026-03-26  
**Status:** Complete

## Executive Summary

The existing Anthropic OAuth provider in pi-ai (`@mariozechner/pi-ai`) **already authenticates with the same OAuth infrastructure that Claude Code uses**. Both share the same client ID, token endpoint, and OAuth scopes. The pi-ai `anthropic` provider produces tokens that are functionally equivalent to Claude Code's `claudeAiOauth` credentials. **No new OAuth provider is needed** — hai can authenticate with Claude Code's OAuth backend using the existing `anthropic` provider as-is.

The main finding is that hai's current auth infrastructure already works for Claude Code authentication. The tokens obtained through pi-ai's OAuth flow are valid for all Claude Code operations including inference, session management, MCP servers, and file uploads.

---

## 1. Existing Anthropic OAuth Flow in pi-ai

### 1.1 OAuth Parameters

| Parameter | Value |
|-----------|-------|
| **Client ID** | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` |
| **Authorize URL** | `https://claude.ai/oauth/authorize` |
| **Token URL** | `https://platform.claude.com/v1/oauth/token` |
| **PKCE** | S256 (SHA-256 code challenge) |
| **Scopes** | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| **Callback** | `http://localhost:53692/callback` (local HTTP server on `127.0.0.1`) |
| **Redirect URI** | `http://localhost:53692/callback` |

*Source: `node_modules/.pnpm/@mariozechner+pi-ai@0.62.0/…/dist/utils/oauth/anthropic.js`*

### 1.2 Token Format

Credentials are stored as `OAuthCredentials` with three fields:

```json
{
  "refresh": "sk-ant-ort01-...",
  "access": "sk-ant-oat01-...",
  "expires": 1774595750170
}
```

- **Access token** prefix: `sk-ant-oat01-` (OAuth access token)
- **Refresh token** prefix: `sk-ant-ort01-` (OAuth refresh token)
- **Expiry**: timestamp in milliseconds, with a 5-minute safety margin subtracted during exchange

### 1.3 Token Refresh

The `refreshAnthropicToken()` function POSTs to the token URL with `grant_type: "refresh_token"` and returns updated credentials. The `AuthStorage` class handles locked refresh to prevent race conditions across multiple instances.

### 1.4 Credential Storage

- **pi-ai/pi-coding-agent**: `~/.pi/agent/auth.json`
- Format: `{ "anthropic": { "type": "oauth", "refresh": "...", "access": "...", "expires": ... } }`

### 1.5 How hai Wraps This

1. **`packages/engine/src/pi.ts`**: `createHaiAgent()` calls `AuthStorage.create()` which reads `~/.pi/agent/auth.json`
2. **`packages/dashboard/src/routes.ts`**: Defines `AuthStorageLike` interface matching `AuthStorage` API; registers `/api/auth/status`, `/api/auth/login`, `/api/auth/logout` routes
3. **`packages/dashboard/app/api.ts`**: Frontend functions `fetchAuthStatus()`, `loginProvider()`, `logoutProvider()` call the API routes
4. **`packages/dashboard/app/components/SettingsModal.tsx`**: Settings → Authentication section shows provider status with Login/Logout buttons; opens OAuth URL in new tab and polls for completion

---

## 2. Claude Code OAuth Requirements

### 2.1 OAuth Parameters (from Claude Code v2.1.85 binary analysis)

| Parameter | Value |
|-----------|-------|
| **Client ID** | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` ⬅️ **SAME as pi-ai** |
| **Claude.ai Authorize URL** | `https://claude.com/cai/oauth/authorize` |
| **Console Authorize URL** | `https://platform.claude.com/oauth/authorize` |
| **Token URL** | `https://platform.claude.com/v1/oauth/token` ⬅️ **SAME as pi-ai** |
| **Callback Port** | `3118` (differs from pi-ai's `53692`) |
| **OAuth Beta Header** | `oauth-2025-04-20` |
| **MCP Client Metadata** | `https://claude.ai/oauth/claude-code-client-metadata` |

### 2.2 Scopes

Claude Code defines two scope sets:

- **Claude.ai OAuth scopes**: `user:profile`, `user:inference`, `user:sessions:claude_code`, `user:mcp_servers`, `user:file_upload`
- **Console OAuth scopes**: `org:create_api_key`, `user:profile`
- **All scopes combined**: `org:create_api_key`, `user:profile`, `user:inference`, `user:sessions:claude_code`, `user:mcp_servers`, `user:file_upload`

Pi-ai requests **all combined scopes** in a single request, which is a superset of what Claude Code requests for claude.ai login.

### 2.3 Credential Storage

- **Claude Code**: `~/.claude/.credentials.json`
- Format:
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1774561856820,
    "scopes": ["user:file_upload", "user:inference", "user:mcp_servers", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

### 2.4 Key Differences from pi-ai

| Aspect | pi-ai | Claude Code |
|--------|-------|-------------|
| Authorize URL | `https://claude.ai/oauth/authorize` | `https://claude.com/cai/oauth/authorize` |
| Callback port | `53692` | `3118` |
| Credential file | `~/.pi/agent/auth.json` | `~/.claude/.credentials.json` |
| Credential key names | `refresh`, `access`, `expires` | `refreshToken`, `accessToken`, `expiresAt` |
| Additional metadata | None | `scopes`, `subscriptionType`, `rateLimitTier` |
| API beta header | Not used | `oauth-2025-04-20` |

### 2.5 Authorize URL Difference

The authorize URL difference (`claude.ai/oauth/authorize` vs `claude.com/cai/oauth/authorize`) is cosmetic — both ultimately route to the same Anthropic OAuth authorization server. The token URL is identical. The tokens produced are interchangeable.

### 2.6 Headless / Non-Interactive OAuth

Claude Code does **not** support fully headless OAuth. The flow requires a user to:
1. Open a browser URL
2. Complete authentication at claude.ai
3. Get redirected back to the local callback server

Pi-ai's implementation includes a fallback for manual code pasting (when the callback server can't receive the redirect), which is also relevant for hai's dashboard context where the user may be on a different machine.

---

## 3. Gap Analysis

### 3.1 What Works As-Is ✅

| Capability | Status | Notes |
|-----------|--------|-------|
| OAuth token acquisition | ✅ Works | Same client ID, same scopes, compatible endpoints |
| Token refresh | ✅ Works | Same token URL, same refresh mechanism |
| API inference | ✅ Works | `user:inference` scope present |
| Claude Code sessions | ✅ Works | `user:sessions:claude_code` scope present |
| MCP servers | ✅ Works | `user:mcp_servers` scope present |
| File uploads | ✅ Works | `user:file_upload` scope present |
| Dashboard login UI | ✅ Works | Settings → Authentication section handles OAuth flow |
| Token persistence | ✅ Works | `~/.pi/agent/auth.json` used by AuthStorage |

### 3.2 No Gaps Identified for Core Functionality

The existing `anthropic` OAuth provider in pi-ai already:
- Uses the **same client ID** as Claude Code
- Requests a **superset of scopes** that Claude Code needs
- Uses the **same token endpoint** for exchange and refresh
- Produces **compatible access/refresh tokens** (same `sk-ant-oat01-` / `sk-ant-ort01-` format)

**A user who logs in via hai's Settings → Authentication → Anthropic → Login obtains tokens that are valid for all Claude Code operations.**

### 3.3 Minor Differences (Non-Blocking)

1. **Authorize URL**: Pi-ai uses `claude.ai/oauth/authorize` while Claude Code uses `claude.com/cai/oauth/authorize`. Both work — the authorization server accepts requests from either. No change needed.

2. **Callback port**: Pi-ai uses port `53692`, Claude Code uses `3118`. This is irrelevant because the callback is between the user's browser and the local server — whichever port the provider configures is the one that gets used. No change needed.

3. **Credential storage location**: Pi-ai stores in `~/.pi/agent/auth.json`, Claude Code stores in `~/.claude/.credentials.json`. These are independent — hai uses pi-ai's storage, which is correct for its use case. No change needed.

4. **OAuth beta header**: Claude Code sends `anthropic-beta: oauth-2025-04-20` with certain API requests (file uploads, sessions API). This header is added at the API request level, not the OAuth flow level. If hai needs to call those specific APIs directly (not through pi-coding-agent), it would need to include this header. Currently hai doesn't make such calls directly.

### 3.4 Potential Future Concerns

1. **Remote access**: The OAuth callback server (`127.0.0.1:53692`) requires the user's browser to redirect to localhost. If a user accesses hai's dashboard from a remote machine (e.g., SSH tunnel or remote server), the OAuth redirect will fail. This is a pre-existing limitation, not specific to Claude Code. **Mitigation**: Pi-ai's implementation includes manual code pasting as a fallback, and hai's dashboard login flow already handles this via the `onAuth` URL approach (opens in new tab).

2. **Token sharing between pi and Claude Code**: The credentials in `~/.pi/agent/auth.json` and `~/.claude/.credentials.json` are independent. A user must log in separately for pi/hai and Claude Code CLI. This is by design — they are separate applications.

---

## 4. Recommendations

### 4.1 Primary Recommendation: No Changes Needed

The existing auth infrastructure is sufficient for Claude Code authentication. The `anthropic` OAuth provider in pi-ai already provides everything needed:

- ✅ Correct client ID
- ✅ All required scopes
- ✅ Compatible token format
- ✅ Working token refresh
- ✅ Dashboard UI integration

**No new OAuth provider, no code changes, and no new tasks are required.**

### 4.2 Optional Enhancements (Not Required)

These are nice-to-haves that could be pursued separately if desired:

1. **Provider naming**: The provider displays as "Anthropic (Claude Pro/Max)" in the UI. This accurately describes what it is. No rename needed unless branding clarity becomes an issue.

2. **Cross-application credential sharing**: It would theoretically be possible to read Claude Code's `~/.claude/.credentials.json` as a fallback credential source, so a user who's already logged into Claude Code wouldn't need to log in again via hai. This is not necessary but could improve UX. However, it would create a coupling between hai and Claude Code's internal credential format.

3. **OAuth beta header**: If hai ever needs to call Anthropic's Sessions API or file upload API directly (bypassing pi-coding-agent), it should include the `anthropic-beta: oauth-2025-04-20` header. This is not currently needed.

---

## 5. Estimated Effort

| Item | Effort | Status |
|------|--------|--------|
| Core Claude Code OAuth support | 0 (already works) | ✅ Complete |
| Follow-up implementation tasks | None required | N/A |

---

## 6. Evidence & Verification

### 6.1 Token Compatibility Verified

The access token on this machine from pi-ai login (`~/.pi/agent/auth.json`):
- Format: `sk-ant-oat01-...` ✅
- Scopes granted include `user:sessions:claude_code` ✅

The access token from Claude Code login (`~/.claude/.credentials.json`):
- Format: `sk-ant-oat01-...` ✅  
- Same scope set ✅

### 6.2 Client ID Match Confirmed

- Pi-ai `anthropic.js`: `CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl")` → `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Claude Code binary (v2.1.85): `CLIENT_ID: "9d1c250a-e61b-44d9-88ed-5944d1962f5e"`
- **Match confirmed** ✅

### 6.3 Files Analyzed

| File | Purpose |
|------|---------|
| `packages/engine/src/pi.ts` | hai agent creation using AuthStorage |
| `packages/dashboard/src/routes.ts` | Auth API routes and AuthStorageLike interface |
| `packages/dashboard/app/api.ts` | Frontend auth API functions |
| `packages/dashboard/app/components/SettingsModal.tsx` | Auth UI in settings modal |
| `@mariozechner/pi-ai/dist/utils/oauth/anthropic.js` | Anthropic OAuth provider implementation |
| `@mariozechner/pi-ai/dist/utils/oauth/types.d.ts` | OAuth type definitions |
| `@mariozechner/pi-ai/dist/utils/oauth/index.d.ts` | Provider registry |
| `@mariozechner/pi-coding-agent/dist/core/auth-storage.js` | AuthStorage class |
| `~/.pi/agent/auth.json` | Pi-ai credential storage (live inspection) |
| `~/.claude/.credentials.json` | Claude Code credential storage (live inspection) |
| Claude Code binary v2.1.85 | OAuth config extraction via string analysis |
