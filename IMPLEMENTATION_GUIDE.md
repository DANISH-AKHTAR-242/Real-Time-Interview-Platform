# Implementation Guide: E2E Validation Setup

> Guide for QA engineers to set up and run end-to-end validation of collaborative editing

---

## 📚 Documentation Files

Your validation toolkit includes:

1. **COLLAB_VALIDATION_GUIDE.md** - Complete reference with all test phases
2. **TEST_SCRIPT_BROWSER_CONSOLE.js** - Automated browser-side tests
3. **QA_QUICK_REFERENCE.md** - One-page cheat sheet for daily testing
4. **METRICS_MONITORING.ts** - Server-side monitoring (optional integration)
5. **This file** - Implementation & setup guide

---

## 🛠️ Setup Phase 1: Prepare Environment

### Step 1: Verify Prerequisites
```bash
# Check Node versions
node --version    # v18+ required
pnpm --version    # v7+ required

# Check ports available
netstat -an | grep -E ':(3002|5173|3001|6379|5432)'
# Should return empty (ports free)
```

### Step 2: Install Dependencies
```bash
# At workspace root
pnpm install

# Verify workspaces resolved
pnpm list --depth=0
# Should show: collab-service, frontend, auth-service, session-service
```

### Step 3: Set Environment Variables
**For development (token bypass):**
```bash
# apps/collab-service/.env.local
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----"
PORT=3002
HOST=0.0.0.0
# Optional:
SESSION_SERVICE_URL=http://localhost:3003
```

**Alternative: Disable auth for testing**
```typescript
// apps/collab-service/src/ws/server.ts - Modify temporarily:
let auth = {
  sessionId: params.get('sessionId') || `dev-session-${Date.now()}`,
  userId: params.get('userId') || `dev-user-${Math.random().toString(36).slice(2, 9)}`
}
// Comment out: // auth = await authenticateUpgradeRequest(request)
```

---

## 🚀 Setup Phase 2: Start Services

### Method A: Three Terminals (Recommended)
```bash
# Terminal 1: Collab Service
cd /workspaces/Real-Time-Interview-Platform
pnpm --filter=collab-service dev

# Terminal 2: Frontend (Env: http://localhost:5173)
cd /workspaces/Real-Time-Interview-Platform
pnpm --filter=frontend dev

# Terminal 3: Monitor (Optional)
watch 'curl -s http://localhost:3002/metrics | jq .activeConnections'
```

### Method B: Docker Compose (Future)
```bash
# Not implemented yet, but framework ready
docker-compose up collab-service frontend postgres redis
```

### Health Check
```bash
# Should succeed (200 status)
curl http://localhost:3002/health

# Expected response:
# {
#   "status": "healthy",
#   "reason": "All systems nominal"
# }
```

---

## 📖 Setup Phase 3: Browser Configuration

### Recommended Setup
- **Browser 1:** Chrome (DevTools monitoring)
- **Browser 2:** Firefox (Full isolation)
- **Both:** Arrange side-by-side
- **DevTools:** Open Console + Network tabs

### Session ID Convention
For testing, use meaningful session IDs:
- `test-session-123` - Basic sync tests
- `test-session-rapid` - Performance tests
- `test-conflict-001` - Conflict tests
- `test-disconnect-001` - Resilience tests

---

## 🧪 Execution: Running Test Phases

### Phase 1: Connection Tests (5 min)

**Browser Console - Browser 1:**
```javascript
// Test 1: Connection
test_WebSocketConnection()

// Test 2: Document initialized
test_YjsDocInitialized()

// Test 3: Awareness
test_AwarenessInitialized()
```

**Expected:** All 3 tests pass ✅

---

### Phase 2: Sync Tests (5 min)

**Browser 1 Console:**
```javascript
// Clear first
clearEditor()

// Test basic sync
test_InsertText()      // Manual insert
test_EditLatency()     // Measure latency
test_LargeContentInsert()  // 5KB insert
```

**Validate in Browser 2:**
```javascript
// Should show same content
printState()
```

---

### Phase 3: Conflict Tests (5 min)

**Browser 1 + Browser 2 Console (run simultaneously):**
```javascript
// Browser 1
clearEditor()
yText.insert(0, 'BROWSER1')

// Browser 2 (at same time)
clearEditor()
yText.insert(0, 'BROWSER2')

// Both - check final state
console.log(yText.toString())  // Should be identical!
```

---

### Phase 4: Presence Tests (2 min)

**Both browsers:**
```javascript
// See connected clients
test_AwarenessClientCount()

// Monitor cursor changes
test_MonitorCursorUpdates()

// Move cursor and observe in other browser
editor.focus()
editor.setPosition({ lineNumber: 5, column: 10 })
```

**Validate:** Remote cursor visible as blue line ✅

---

### Phase 5: Performance Tests (10 min)

**Browser 1 Console:**
```javascript
// Rapid inserts
await test_RapidSequentialInserts()  // 100 inserts

// Large document
await test_LongContentDocument()     // 50 lines

// Stress test
await test_RapidSequentialInserts()  // Repeat 3x
test_MemoryStability()               // Check heap
```

**Performance Criteria:**
- 100 inserts: <500ms ✅
- 50 lines: 100% displayed ✅
- Memory: <100MB heap ✅

---

### Phase 6: Resilience Tests (10 min)

**Test A: Network Throttling**
```javascript
// Browser 1: Simulate offline
// DevTools → Network → Throttle (Offline)

// Type some text
yText.insert(0, 'OFFLINE-TEST')

// Re-enable network
// Should sync automatically
console.log(yText.toString())  // Should have OFFLINE-TEST
```

**Test B: Server Restart**
```
1. Both browsers connected
2. Type in B1: "BEFORE-RESTART"
3. Terminal: Stop collab-service (Ctrl+C)
4. Wait 2 seconds
5. Terminal: Restart (pnpm --filter=collab-service dev)
6. Both browsers: Click "Connect" button
7. Both should see: "BEFORE-RESTART"
```

---

## 📊 Automated Test Suite

### Run All Tests
```javascript
// Copy entire content of TEST_SCRIPT_BROWSER_CONSOLE.js into console
// Then run:
await runAllTests()

// View results:
TEST_RESULTS.forEach(r => {
  console.log(`${r.passed ? '✅' : '❌'} ${r.name}`)
})

// Export as CSV:
copy(TEST_RESULTS.map(r => `${r.name},"${r.message}"`).join('\n'))
```

### Expected Output
```
✅ Connection Tests (3/3)
  ✅ WebSocket Connected
  ✅ Yjs Document Created
  ✅ Awareness Connected

✅ Sync Tests (4/4)
  ✅ Editor Sync
  ✅ Insert Text
  ✅ Delete Text
  ✅ Large Content Insert (5KB)

✅ Conflict Tests (2/2)
  ✅ Simultaneous Local Edits
  ✅ Content Modification

✅ Presence Tests (2/2)
  ✅ Local Presence State
  ✅ Awareness Clients

✅ Stress Tests (3/3)
  ✅ Rapid Sequential Inserts (100x)
  ✅ Memory Usage
  ✅ Long Content Document

Results: 16/16 tests passed ✅
```

---

## 🔍 Monitoring & Observability

### Method 1: Browser DevTools

**Network Tab:**
- Filter: `WS` (WebSocket)
- Check frame size and frequency
- Measure round-trip latency

**Console:**
```javascript
// Monitor all changes
yText.observe(event => {
  console.log('[Yjs Update]', event)
})

// Monitor connection
provider.on('status', e => {
  console.log('[Provider]', e.status)
})

// Monitor awareness
awareness.on('change', e => {
  console.log('[Awareness]', e.changed)
})
```

### Method 2: Server Metrics Endpoint

**Installation:**
```typescript
// Add to apps/collab-service/src/ws/server.ts:
import { metricsCollector, setupMetricsEndpoint } from '../../METRICS_MONITORING'

setupMetricsEndpoint(httpServer)

wsServer.on('connection', (socket, request, context) => {
  const { sessionId, userId } = context
  metricsCollector.recordClientConnection(socket, sessionId, userId)
  
  socket.on('close', () => {
    metricsCollector.recordClientDisconnection(socket, sessionId)
  })
})
```

**Query Metrics:**
```bash
# All metrics
curl http://localhost:3002/metrics | jq .

# Health check
curl http://localhost:3002/health

# Specific fields
curl http://localhost:3002/metrics | jq '.activeConnections'
```

### Method 3: CLI Monitoring
```bash
# Watch active connections
watch -n 1 'curl -s http://localhost:3002/metrics | jq ".activeConnections"'

# Monitor file descriptors
watch -n 2 'lsof -p $(pgrep -f "tsx.*server.ts") | wc -l'

# Check memory in real-time
ps aux | grep collab-service | awk '{print $6 " KB"}'
```

---

## 🔧 Troubleshooting & Recovery

### Issue 1: Auth Token Required
**Symptom:** 401 Unauthorized errors

**Quick Fix:**
```typescript
// Temporarily in collab-service/src/ws/auth.ts:
export async function authenticateUpgradeRequest(request: IncomingMessage) {
  // Return mock auth for testing
  return {
    userId: `test-${Math.random().toString(36).slice(2, 9)}`,
    sessionId: 'test-session'
  }
}
```

**Proper Fix:**
- Implement auth-service: `pnpm --filter=auth-service dev`
- Generate valid JWT tokens
- Pass token in WebSocket URL params

### Issue 2: Connection Drops
**Symptom:** `[frontend] y-websocket disconnected`

**Diagnosis:**
```bash
# Check server running
lsof -i :3002

# Check logs
grep "disconnected" collab-service.log

# Check for errors
curl http://localhost:3002/health
```

**Fix:**
```bash
# 1. Restart server
pkill -f "tsx.*server.ts"
pnpm --filter=collab-service dev

# 2. Clear browser cache
# DevTools → Application → Clear All
# Then hard refresh: Ctrl+Shift+R

# 3. Check firewall
sudo ufw allow 3002  # Linux
```

### Issue 3: Different Content in Two Browsers
**Symptom:** Browser 1 shows "AAA", Browser 2 shows "BBB"

**Diagnosis:**
```javascript
// Both browsers:
console.log('Content:', yText.toString())
console.log('Length:', yText.length)
console.log('Awareness clients:', awareness.getStates().size)
```

**Fix:**
```javascript
// Nuclear option: restart
// 1. Both browsers: refresh page
// 2. Server: stop and start
// 3. Both reconnect to fresh session ID
```

### Issue 4: Memory Leak
**Symptom:** Process grows to >500MB

**Check:**
```javascript
// Browser console:
performance.memory // Shows heap usage

// Server:
ps aux | grep collab-service
# Check growth over time: RSS column
```

**Fix:**
```typescript
// Check cleanup in CollabEditor.tsx:
return () => {
  provider.destroy()      // ✅ Required
  binding.destroy()       // ✅ Required
  awareness.setLocalState(null)  // ✅ Required
  // ... all others in COLLAB_VALIDATION_GUIDE.md
}
```

---

## 📋 Pre-Test Checklist

- [ ] Services running (collab-service + frontend)
- [ ] Ports available: 3002, 5173
- [ ] Browsers opened and side-by-side
- [ ] DevTools open (F12) with Console + Network tabs
- [ ] No console errors on page load
- [ ] WebSocket connection shows 101 status
- [ ] Test script loaded (TEST_SCRIPT_BROWSER_CONSOLE.js)
- [ ] Know session ID to use
- [ ] Have test log template ready

---

## 📝 Reporting Test Results

### Minimal Report
```
Date: 2026-03-27
Tester: QA Engineer
Result: ✅ PASS (16/16 tests)
Issues: None
```

### Detailed Report
```
Platform: Chrome on Ubuntu 24.04
Session ID: test-sync-001
Test Duration: 15 minutes

Results:
✅ Phase 1: Connection (3/3)
✅ Phase 2: Sync (4/4)
✅ Phase 3: Conflicts (2/2)
✅ Phase 4: Presence (2/2)
✅ Phase 5: Performance (3/3)
✅ Phase 6: Resilience (TBD)

Metrics:
- Avg Latency: 42ms
- Peak Connection: 2 clients
- Messages Processed: 143
- Errors: 0

Summary: System operating nominally
Recommendation: Ready for production
```

---

## 🎓 Advanced Topics

### Adding Custom Tests
```javascript
// In TEST_SCRIPT_BROWSER_CONSOLE.js or browser console:
function test_MyCustomScenario() {
  // Setup
  clearEditor()
  
  // Action
  yText.insert(0, 'My test content')
  
  // Verify
  const passed = yText.toString() === 'My test content'
  
  // Log
  logTest('My Custom Test', passed, 'Description of result')
  
  return passed
}

// Run
test_MyCustomScenario()
```

### Load Testing Pattern
```javascript
// Stress test with N clients
async function simulateNConcurrentClients(n) {
  const promises = []
  
  for (let i = 0; i < n; i++) {
    // Would need N browser windows or a headless client
    promises.push(
      new Promise(resolve => {
        setTimeout(() => {
          yText.insert(i, `LOAD-${i}`)
          resolve()
        }, Math.random() * 1000)
      })
    )
  }
  
  return Promise.all(promises)
}
```

### Persistence Testing (If Redis enabled)
```bash
# With Redis enabled:
# 1. Ensure redis-cli available
redis-cli

# 2. Check data
KEYS *

# 3. Monitor
MONITOR
```

---

## 🔗 Support Resources

- **Main Validation Guide:** [COLLAB_VALIDATION_GUIDE.md](./COLLAB_VALIDATION_GUIDE.md)
- **Quick Reference:** [QA_QUICK_REFERENCE.md](./QA_QUICK_REFERENCE.md)
- **Test Script:** [TEST_SCRIPT_BROWSER_CONSOLE.js](./TEST_SCRIPT_BROWSER_CONSOLE.js)
- **Monitoring Setup:** [METRICS_MONITORING.ts](./METRICS_MONITORING.ts)

---

## ✅ Success Criteria

System is production-ready when:
- ✅ All 16 automated tests pass
- ✅ <100ms sync latency confirmed
- ✅ No conflicts in simultaneous edits
- ✅ Graceful disconnect/reconnect
- ✅ Remote cursors visible and accurate
- ✅ Sustained 5+ minute operation stable
- ✅ <50MB memory per session
- ✅ No data loss on restart
- ✅ Auth tokens validated (if enabled)

---

**Generated:** March 27, 2026  
**For:** QA Engineers - Real-Time Interview Platform  
**Status:** Ready for Testing
