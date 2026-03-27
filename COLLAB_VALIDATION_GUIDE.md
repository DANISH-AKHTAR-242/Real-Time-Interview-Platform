# Collaborative Editing System - E2E Validation Guide

## Architecture Overview

```
┌─────────────┐        WebSocket (ws://)       ┌──────────────────┐
│  Browser 1  │◄──────────────────────────────►│                  │
│  (Frontend)  │    + JWT Token in URL Params  │ Collab-Service   │
└─────────────┘                                 │ (Node.js + WS)   │
                                                │                  │
┌─────────────┐        WebSocket (ws://)       │  Storage:        │
│  Browser 2  │◄──────────────────────────────►│  - Yjs Doc       │
│  (Frontend)  │    + JWT Token in URL Params  │  - Awareness     │
└─────────────┘                                 └──────────────────┘
       │                                               │
       └──────────────────────────────────────────────┘
              Synced via Yjs CRDT Algorithm
              Conflict-free append-only logs
```

## Prerequisites & Setup
### Environment Variables
**collab-service:**
```bash
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
PORT=3002
HOST=0.0.0.0
SESSION_SERVICE_URL=http://localhost:3003  # Optional
```

**frontend:**
```bash
VITE_COLLAB_SERVICE_WS=ws://localhost:3002
```

### Quick Start Commands
```bash
# Install dependencies
pnpm install

# Terminal 1: Start collab-service
pnpm --filter=collab-service dev

# Terminal 2: Start frontend (Vite dev server)
pnpm --filter=frontend dev

# Terminal 3: (Optional) Start auth-service if needed
pnpm --filter=auth-service dev
```

---

## PHASE 1: Basic Setup & Health Check

### Step 1.1: Service Startup Validation
**Expected Behavior:**
- ✅ Collab-service logs: `[collab-service] listening on ws://0.0.0.0:3002`
- ✅ Frontend startup: Vite dev server on `http://localhost:5173`
- ✅ No errors in browser console

**Test:**
```bash
# Terminal 1 - Collab Service Startup
pnpm --filter=collab-service dev
# Expected output:
# [collab-service] listening on ws://0.0.0.0:3002
```

**Validation Checklist:**
- [ ] Collab-service is listening on port 3002
- [ ] Frontend builds without TypeScript errors
- [ ] No connection errors in frontend console
- [ ] Both services running in separate terminals

---

### Step 1.2: Open Two Browser Windows
**Process:**
1. Open browser 1: `http://localhost:5173`
2. Open browser 2: `http://localhost:5173` (incognito/new window)
3. Both should show the editor UI with "Session ID" input field

**Validation Checklist:**
- [ ] Both windows load the frontend UI
- [ ] Both have the session ID input field (default: "session-123")
- [ ] Both have an empty Monaco editor
- [ ] Browser dev tools open (F12) - check Network tab for WebSocket connections

---

### Step 1.3: Connect Both Clients to Same Session
**Process:**
1. In Browser 1: Keep Session ID as "session-123" and click "Connect"
2. In Browser 2: Keep Session ID as "session-123" and click "Connect"

**Expected Network Activity:**
- ✅ WebSocket upgrade request to `ws://localhost:3002/session-123`
- ✅ Status: 101 Switching Protocols
- ✅ Console log: `[frontend] y-websocket connected session=session-123`

**Validation Checklist:**
- [ ] Both browsers show "WebSocket: ws://localhost:3002/session-123"
- [ ] Collab-service shows: `[collab-service] connected user=xxx session=session-123`
- [ ] No 401/403 errors (if auth enabled, adjust tokens as needed)
- [ ] WebSocket connection status message appears in browser console

**⚠️ Known Issue - Authentication:**
If you see `401 Unauthorized` errors:
- **Cause:** Frontend not sending JWT token in WebSocket URL
- **Fix:** For testing, modify `CollabEditor.tsx`:
  ```typescript
  // Line 61 in CollabEditor.tsx - Add mock token
  const provider = new WebsocketProvider(
    'ws://localhost:3002',
    sessionId,
    doc,
    {
      connect: true,
      // Add if auth enabled:
      // params: { token: 'your-jwt-token', sessionId }
    }
  )
  ```
- **Alternative:** Disable token verification in auth.ts for testing

---

## PHASE 2: Real-Time Sync Validation

### Step 2.1: Type in Browser 1, Verify Sync in Browser 2 (<100ms)

**Process:**
1. Click editor in Browser 1
2. Type: `const hello = "world"`
3. Observe Browser 2 editor in real-time

**Expected Behavior:**
- ✅ Text appears in Browser 2 within 100ms
- ✅ Cursor position updates in real-time
- ✅ No visual lag or double-typing

**Measurement:**
- Open DevTools → Performance tab
- Record while typing
- Check WebSocket message frequency (should be batched)
- Latency: Look for message send/receive within 100ms

**Validation Checklist:**
- [ ] Text syncs to Browser 2 within 100ms
- [ ] No duplicate characters
- [ ] No missing characters
- [ ] Cursor position matches in both browsers

### Step 2.2: Type in Browser 2, Verify Sync in Browser 1

**Process:**
- Repeat Step 2.1 but type in Browser 2
- Type: `function test() { }`

**Expected Behavior:**
- ✅ Text appears in Browser 1 within 100ms
- ✅ Remote cursor (blue indicator) visible in Browser 1
- ✅ Text is appended (not replaced)

**Validation Checklist:**
- [ ] Bidirectional sync works
- [ ] Remote cursor label visible (e.g., "User-1234")
- [ ] Text appended correctly to existing text

---

## PHASE 3: Conflict-Free Property Testing

### Step 3.1: Simultaneous Editing (No Conflicts)

**Process:**
1. Clear both editors (or start fresh)
2. Position cursor in Browser 1 at position 0
3. Position cursor in Browser 2 at position 0
4. **Simultaneously** type in both:
   - Browser 1: Type `AAA` (3 chars)
   - Browser 2: Type `BBB` (3 chars)
5. Wait 500ms for sync
6. Verify final state

**Expected Behavior:**
- ✅ Final text in both browsers: Either `AAABBB` or `BBBAAA` (consistent)
- ✅ Both browsers show **identical** text (no conflicts)
- ✅ No data loss
- ✅ No partial characters

**How to Test Simultaneously:**
```javascript
// Run in Browser 1 console:
editor.setValue('');
editor.getAction('editor.action.insertLineAfter').run();
```

```javascript
// Run in Browser 2 console at same time:
editor.setValue('');
editor.getAction('editor.action.insertLineAfter').run();
```

**Validation Checklist:**
- [ ] Final state is consistent between browsers
- [ ] No conflicting edits
- [ ] Both browsers reached same state within 500ms
- [ ] No timeout or retry errors in console

### Step 3.2: Rapid Sequential Edits

**Process:**
1. Browser 1: Type quickly: `123456789`
2. Wait 50ms
3. Browser 2: Type quickly: `abcdefgh`
4. Verify no interleaving

**Expected Behavior:**
- ✅ Final text: `123456789abcdefgh` (append order preserved)
- ✅ All characters present and in correct order

**Validation Checklist:**
- [ ] All typed characters present
- [ ] Order preserved (first browser's text, then second)
- [ ] Character count matches (9 + 8 = 17)
- [ ] No duplicate or missing chars

---

## PHASE 4: Data Integrity Testing

### Step 4.1: Multi-line Content

**Process:**
1. Browser 1: Type
   ```
   function add(a, b) {
     return a + b;
   }
   ```
2. Browser 2: Verify content appears correctly
3. Add more lines in Browser 2

**Expected Behavior:**
- ✅ Line breaks preserved
- ✅ Indentation preserved
- ✅ All whitespace preserved

**Validation Checklist:**
- [ ] Line breaks synced correctly
- [ ] Indentation preserved (spaces/tabs)
- [ ] No corrupted characters
- [ ] Editor language mode correct (TypeScript)

### Step 4.2: Special Characters & Unicode

**Process:**
1. Browser 1: Type special characters:
   ```
   emoji: 🎉 ✨ 🚀
   symbols: @#$%^&*()
   quotes: 'single' "double" `backtick`
   ```
2. Browser 2: Verify rendering

**Expected Behavior:**
- ✅ All characters render correctly
- ✅ No encoding issues
- ✅ Emoji display properly

**Validation Checklist:**
- [ ] Emoji display correctly
- [ ] All symbols present
- [ ] No character encoding errors
- [ ] Monaco renders special chars properly

---

## PHASE 5: Connection Resilience Testing

### Step 5.1: WebSocket Disconnect & Reconnect

**Test 1: Browser Tab Close**
```
Process:
1. Browser 1: Type some text "Test123"
2. Browser 2: Verify text appears
3. Browser 1: Close the tab
4. Collab-service logs should show:
   [collab-service] disconnected user=xxx session=session-123
5. Browser 2: Continue typing
6. Browser 1: Reopen tab and connect with same sessionId
7. Browser 1: Should see all text (including "Test123")
```

**Expected Behavior:**
- ✅ Disconnect logged cleanly
- ✅ Browser 2 continues editing
- ✅ Browser 1 rejoins and receives full document state
- ✅ No text loss

**Validation Checklist:**
- [ ] Disconnect logged in collab-service
- [ ] Other client unaffected
- [ ] Rejoined client receives full state
- [ ] No duplicate text on rejoin

**Test 2: Network Throttling (Chrome DevTools)**
```
Process:
1. Browser 1: Open DevTools → Network tab
2. Set throttling: "Slow 3G" or "Offline"
3. Type text slowly: "abcdef"
4. Re-enable network
5. Verify text syncs once reconnected
```

**Expected Behavior:**
- ✅ Text buffers locally while offline
- ✅ Syncs when network returns
- ✅ No text loss
- ✅ No duplicate sends

**Validation Checklist:**
- [ ] Offline text buffered (check localStorage)
- [ ] Syncs on reconnect
- [ ] No data loss
- [ ] No duplicate messages

### Step 5.2: Collab-Service Restart

**Process:**
```
1. Both browsers connected to session-123
2. Browser 1: Type "Before restart"
3. Terminal with collab-service: Ctrl+C to stop
4. Browser 1 & 2: Monitor for disconnection (will show "disconnected" status)
5. Important: Wait 5 seconds
6. Restart collab-service: pnpm --filter=collab-service dev
7. Browser 1: Click "Connect" again with same sessionId
8. Browser 2: Click "Connect" again with same sessionId
9. Verify: Both browsers see "Before restart" text
```

**Expected Behavior:**
- ✅ Browsers detect disconnection
- ✅ Browsers can reconnect
- ✅ Full document state restored from Yjs
- ✅ No text loss

**Validation Checklist:**
- [ ] Both browsers show "disconnected" status when server stops
- [ ] Reconnection succeeds after restart
- [ ] Text "Before restart" persists
- [ ] Collab-service logs new client connections
- [ ] No console errors

**⚠️ Important Notes:**
- Yjs state is **in-memory** (lost on restart)
- For persistence, need Redis/Database backend
- See "Production Setup" section for persistence

---

## PHASE 6: Presence & Awareness Testing

### Step 6.1: Remote Cursor Visibility

**Process:**
1. Browser 1: Click in editor
2. Browser 2: Watch left side of editor
3. Browser 1: Move cursor around
4. Browser 2: Should see colored line (remote cursor)

**Expected Behavior:**
- ✅ Colored vertical line appears in Browser 2
- ✅ Label shows: "User-XXXX" above cursor
- ✅ Cursor updates as it moves
- ✅ Color consistent (assigned per user)

**Validation Checklist:**
- [ ] Remote cursor visible as colored line
- [ ] User name label shown
- [ ] Cursor follows movement
- [ ] Cursor disappears when editor blurred

### Step 6.2: Multiple Remote Cursors

**Process:**
1. Open 3 browser windows (A, B, C)
2. All connect to same sessionId
3. A: Type text and move cursor
4. B: Move cursor to different position
5. C: Observe both remote cursors (A and B)

**Expected Behavior:**
- ✅ C sees 2 colored cursor lines
- ✅ Different colors for A and B
- ✅ Both labels visible
- ✅ All cursors update independently

**Validation Checklist:**
- [ ] Multiple remote cursors visible
- [ ] Each cursor different color
- [ ] Cursor position updates in real-time
- [ ] No cursor "ghost" after user leaves

---

## PHASE 7: Performance & Stress Testing

### Step 7.1: Rapid Typing (1000+ characters)

**Process:**
```javascript
// Run in Browser 1 console:
const text = 'x'.repeat(1000);
editor.trigger('source', 'type', { text });
```

**Expected Behavior:**
- ✅ All 1000 chars sync to Browser 2
- ✅ No lag or freeze
- ✅ Sync completes within 500ms
- ✅ Browser 2 receives complete text

**Measurement:**
- Monitor Network tab: look for WebSocket frames
- Check timeline for frame drops (DevTools → Performance)
- Memory usage (Task Manager)

**Validation Checklist:**
- [ ] 1000 characters fully synced
- [ ] No input lag during typing
- [ ] No frame rate drops
- [ ] Memory steady (not leaking)

### Step 7.2: Paste Large Content

**Process:**
```javascript
// Generate 10KB of content and paste
const largeText = 'a'.repeat(10000);
editor.trigger('source', 'paste', { text: largeText });
```

**Expected Behavior:**
- ✅ Large paste handled gracefully
- ✅ All content synced to Browser 2 within 1 second
- ✅ No timeout errors
- ✅ Editor remains responsive

**Validation Checklist:**
- [ ] 10KB pasted successfully
- [ ] Synced to other client
- [ ] Editor responsive during paste
- [ ] No connection drops
- [ ] No memory spike

### Step 7.3: Sustained Load (5 minutes)

**Process:**
```javascript
// Browser 1: Type continuously for 5 minutes
setInterval(() => {
  const char = String.fromCharCode(33 + Math.random() * 93);
  editor.trigger('source', 'type', { text: char });
}, 100); // One char every 100ms = 600 chars/min
```

**Expected Behavior:**
- ✅ Continuous typing works smoothly
- ✅ All chars sync to Browser 2
- ✅ No connection drops
- ✅ No memory leak
- ✅ Consistent latency (<100ms)

**Monitoring:**
- Chrome DevTools: Memory tab (check for steady state)
- WebSocket frame count (should be consistent)
- CPU usage (should stay <30% per process)

**Validation Checklist:**
- [ ] 5 minutes continuous operation
- [ ] No connection drops
- [ ] No memory growth
- [ ] Latency remains <100ms
- [ ] No browser crashes

---

## PHASE 8: Debugging & Troubleshooting

### Common Issues & Fixes

#### Issue 1: WebSocket Connection Refused
```
Error: WebSocket is closed before the connection is established
```
**Diagnosis:**
```bash
# Check collab-service is running
netstat -an | grep 3002
# OR: curl http://localhost:3002 (should fail, is WS only)
```
**Fix:**
1. Ensure collab-service running: `pnpm --filter=collab-service dev`
2. Check port 3002 not in use: `lsof -i :3002`
3. Check firewall not blocking
4. Frontend must use correct host: `ws://localhost:3002` (not `ws://127.0.0.1:3002`)

#### Issue 2: Text Not Syncing
```
Typed in Browser 1, doesn't appear in Browser 2
```
**Diagnosis:**
1. Check WebSocket connection status:
   ```javascript
   // Browser console:
   console.log(provider.status); // 'connected' or 'disconnected'
   ```
2. Check Yjs binding:
   ```javascript
   console.log(yText.toString()); // Should have your text
   ```
3. Check awareness state:
   ```javascript
   console.log(awareness.getLocalState());
   ```

**Fix - Step 1: Verify Connection**
```javascript
// Browser 1 console:
provider.on('status', event => {
  console.log('WebSocket status:', event.status);
});
```

**Fix - Step 2: Manual Sync Test**
```javascript
// Browser 1 console - Force text update:
yText.insert(0, 'test-text-123');

// Browser 2 console - Check if received:
console.log(yText.toString());
```

**Fix - Step 3: Check Yjs Version Mismatch**
```bash
# Both must use same Yjs version:
pnpm list yjs
# Should be: yjs@13.6.26 (or consistent across apps)
```

**Fix - Step 4: Restart Services**
```bash
pnpm --filter=collab-service dev --force
pnpm --filter=frontend dev
# Hard refresh frontend (Ctrl+Shift+R)
```

#### Issue 3: Conflicts / Content Differs Between Browsers
```
Browser 1: "AAABBB"
Browser 2: "BBBAA"
```
**Cause:** Yjs CRDT algorithm should prevent this - might be race condition

**Diagnosis:**
1. Check both browsers connected to same sessionId:
   ```javascript
   // Browser console:
   console.log(sessionId); // Must match
   ```
2. Check Yjs client ID:
   ```javascript
   console.log(doc.clientID); // Should differ between browsers
   ```
3. Check update timestamps:
   ```javascript
   yText.observe(event => {
     event.mutations.forEach(mutation => {
       console.log('Mutation:', mutation);
     });
   });
   ```

**Fix:**
1. Clear both browsers (close tabs, localStorage)
2. Restart collab-service
3. Reconnect with fresh session ID
4. If still occurs, check Yjs + y-websocket versions match

#### Issue 4: Remote Cursor Not Showing
```
Can see Browser 1's typing but no cursor indicator in Browser 2
```

**Diagnosis:**
```javascript
// Browser 2 console:
const states = awareness.getStates();
console.log('Awareness states:', states);
// Should have entry for Browser 1's clientId with user + cursor data
```

**Fix:**
1. Check cursor event listener:
   ```javascript
   // CollabEditor.tsx - verify this runs:
   awareness.on('change', updateRemoteDecorations);
   ```
2. Manual test:
   ```javascript
   // Browser 1: Set cursor
   awareness.setLocalStateField('cursor', { anchor: 0, head: 5 });
   
   // Browser 2: Observe
   awareness.on('change', () => {
     console.log('Awareness changed');
   });
   ```

#### Issue 5: High Latency / Lag
```
Typing appears with noticeable delay (>500ms)
```

**Diagnosis - Check Network:**
```javascript
// Browser console - add timing:
let lastSend = Date.now();
provider.on('send', () => {
  console.log('Send latency:', Date.now() - lastSend);
  lastSend = Date.now();
});
```

**Fix Priority:**
1. **Network:**
   - Check DevTools → Network → WS connection
   - Look at message round-trip time
   - Disable VPN/proxy if present
   - Use wired connection if on WiFi

2. **Browser:**
   - Close other tabs
   - Check CPU usage (Task Manager)
   - Disable extensions (AdBlock, etc.)
   - Try Incognito mode

3. **Server:**
   - Check collab-service logs for errors
   - Monitor CPU: `top -p $(pgrep -f 'collab-service')`
   - Check disk I/O: `iostat 1`

4. **Code:**
   - Check MonacoBinding is created correctly
   - Check no infinite loops in awareness handler
   - Monitor editor.deltaDecorations calls (can be expensive)

#### Issue 6: Browser Crash After Disconnect/Reconnect
```
Browser reloads or crashes when joining again
```

**Cause:** Resource leak in cleanup

**Fix in CollabEditor.tsx:**
```typescript
// Make sure return cleanup function handles all:
return () => {
  awareness.off('change', awarenessUpdateHandler)
  awareness.setLocalState(null)  // Clear presence
  binding.destroy()               // Destroy binding
  provider.destroy()              // Destroy provider
  decorationIds = editor.deltaDecorations(decorationIds, [])
  editor.dispose()                // Dispose editor
  model.dispose()                 // Dispose model
  doc.destroy()                   // Destroy Y.Doc
  styleElement.remove()           // Clean up injected styles
  selectionDisposable.dispose()   // Remove cursor listener
}
```

#### Issue 7: Authentication Failures (401/403)
```
Error: 401 Unauthorized
```

**Diagnosis:**
```bash
# Check auth-service running (if needed):
pnpm --filter=auth-service dev

# Check JWT_PUBLIC_KEY set:
echo $JWT_PUBLIC_KEY | head -c 50
```

**Fix Options:**

**Option A: For Development (Disable Auth)**
```typescript
// apps/collab-service/src/ws/server.ts
// Temporarily comment out auth check:
const auth = {
  sessionId: sessionId || 'dev-session',
  userId: `dev-user-${Math.random().toString(36).slice(2, 9)}`
}
```

**Option B: Use Test Token**
```javascript
// Browser console - Create mock JWT:
const testToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...';

// Update WebsocketProvider call:
const provider = new WebsocketProvider(
  `ws://localhost:3002?token=${testToken}&sessionId=${sessionId}`,
  sessionId,
  doc
);
```

**Option C: Generate Valid Token**
```bash
# From auth-service (if available):
curl -X POST http://localhost:3001/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user"}'
# Use returned token in URL params
```

---

## Test Automation Scripts

### Browser Console - Quick Validation
```javascript
// Validate both browsers show same content
const testScript = () => {
  const text = yText.toString();
  console.log('Current Content:', text);
  console.log('Content Length:', text.length);
  console.log('WebSocket Status:', provider.status);
  console.log('Awareness Count:', awareness.getStates().size);
  const states = awareness.getStates();
  states.forEach((state, clientId) => {
    console.log(`Client ${clientId}:`, state);
  });
};
testScript();
```

### Collab-Service - Metrics Check
```bash
# Monitor WebSocket connections
watch -n 1 'lsof -i :3002 | grep ESTABLISHED | wc -l'

# Monitor file descriptors
watch -n 1 'lsof -p $(pgrep -f "collab-service") | wc -l'

# Check memory usage
ps aux | grep collab-service | grep -v grep
```

---

## Expected Sync Latencies

| Test Case | Expected | Tolerance |
|-----------|----------|-----------|
| Simple keystroke | <50ms | 100ms max |
| Paste 1KB | <200ms | 500ms max |
| Paste 10KB | <1000ms | 2000ms max |
| Reconnect | <2000ms | 5000ms max |
| Cursor update | <50ms | 100ms max |
| Server restart recovery | <5000ms | 10000ms max |

---

## Production Setup (Persistence)

### Adding Redis for State Persistence
```yaml
# docker-compose.yml
collab-service:
  environment:
    REDIS_URL: redis://localhost:6379
```

```typescript
// apps/collab-service/src/yjs/setup.ts - Add persistence:
import Redis from 'ioredis';
import { setPersistence } from '@y/websocket-server/persistence';

const redis = new Redis();
setPersistence({
  provider: redisProvider,
  binding: yBindRedis,
});
```

### Key Metrics to Monitor
- WebSocket connection count: `netstat -an | grep 3002 | grep ESTABLISHED | wc -l`
- Yjs document size: Track in collab-service logs
- Message throughput: Bytes/sec (Network tab)
- P95 latency: WebSocket frame timing
- Memory per session: Monitor growth over time

---

## Checklist Summary

### ✅ Pre-Test
- [ ] Services start without errors
- [ ] Ports 3002 (collab-service) and 5173 (frontend) available
- [ ] Both browser windows load correctly
- [ ] DevTools open for network inspection

### ✅ Basic Sync (Phase 2-3)
- [ ] Text syncs in <100ms
- [ ] Bidirectional sync works
- [ ] Simultaneous edits don't conflict
- [ ] No data loss

### ✅ Resilience (Phase 5)
- [ ] Disconnection handled gracefully
- [ ] Reconnection restores state
- [ ] Server restart doesn't lose state
- [ ] No duplicate messages on reconnect

### ✅ Presence (Phase 6)
- [ ] Remote cursors visible
- [ ] User names shown
- [ ] Multiple cursors working
- [ ] Cursor position accurate

### ✅ Performance (Phase 7)
- [ ] Rapid typing (1000+ chars) smooth
- [ ] Large paste (<10KB) handle
- [ ] 5-minute sustained load stable
- [ ] No memory leaks
- [ ] Consistent latency

---

## Quick Start Test Plan (10 minutes)

```
1. [2 min] Services: pnpm --filter=collab-service dev & pnpm --filter=frontend dev
2. [2 min] Browser Setup: Open 2 windows, connect to "session-123"
3. [2 min] Sync Test: Type in B1, verify appears in B2 within 100ms
4. [2 min] Conflict Test: Spam type simultaneously in both, verify same final text
5. [2 min] Disconnect Test: Ctrl+C collab-service, restart, reconnect, verify no data loss
```

**Result:** ✅ Collaborative editing works end-to-end if all pass

---

## Support & Next Steps

### If Tests Fail:
1. Check "Debugging & Troubleshooting" section (Phase 8)
2. Enable verbose logging:
   ```bash
   DEBUG=* pnpm --filter=collab-service dev
   ```
3. Monitor network in DevTools → Network → WS
4. Check browser console for errors
5. Review auth configuration if 401 errors

### To Extend System:
- [ ] Add Redis persistence
- [ ] Add history/undo tracking
- [ ] Add user authentication UI
- [ ] Add session management
- [ ] Add collaborative cursors with animations
- [ ] Add offline-first support
- [ ] Add version control/snapshots

### Performance Optimization:
- [ ] Enable compression on WebSocket
- [ ] Batch Yjs updates (requestIdleCallback)
- [ ] Lazy load editor for multiple tabs
- [ ] Add connection pooling for Redis
- [ ] Monitor and optimize MonacoBinding decorations
