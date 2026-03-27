# Collaborative Editing - QA Quick Reference Card

> **Print this page** for reference during testing

---

## 🚀 Quick Start (5 minutes)

```bash
# Terminal 1: Start collab-service
pnpm --filter=collab-service dev

# Terminal 2: Start frontend  
pnpm --filter=frontend dev
```

Browser: `http://localhost:5173`

---

## 📋 Essential Tests Checklist

### ✅ SETUP PHASE (2 min)
- [ ] Services started without errors
- [ ] Port 3002 listening: `netstat -an | grep 3002`
- [ ] Frontend loads: `http://localhost:5173`
- [ ] DevTools Console open (F12)
- [ ] Network tab visible

### ✅ SYNC PHASE (3 min)
- [ ] Open Browser 1 & Browser 2
- [ ] Both connect to `session-123`
- [ ] Type in B1: `Hello`
- [ ] Appears in B2 within 100ms: **✅ YES / ❌ NO**
- [ ] Type in B2: `World`
- [ ] Appears in B1 within 100ms: **✅ YES / ❌ NO**

### ✅ CONFLICT PHASE (2 min)
- [ ] Clear both editors
- [ ] **Simultaneously** type:
  - B1: `AAA`
  - B2: `BBB`
- [ ] Final text identical in both: **✅ YES / ❌ NO**
- [ ] Expected: `AAABBB` or `BBBAAA` (consistent)

### ✅ RESILIENCE PHASE (3 min)
- [ ] Type text in B1: `BeforeRestart`
- [ ] Stop collab-service: `Ctrl+C`
- [ ] B1 & B2 show disconnected: **✅ YES / ❌ NO**
- [ ] Restart collab-service: `pnpm --filter=collab-service dev`
- [ ] Reconnect both browsers
- [ ] Both show original text: **✅ YES / ❌ NO**

### ✅ PRESENCE PHASE (2 min)
- [ ] B1: Click editor
- [ ] B2: Watch for blue cursor line: **✅ YES / ❌ NO**
- [ ] B1: Move cursor around
- [ ] B2: Cursor line follows movement: **✅ YES / ❌ NO**
- [ ] User name label visible: **✅ YES / ❌ NO**

---

## 🧪 Browser Console Testing

**Copy & paste into DevTools Console:**

```javascript
// Quick validation
runAllTests()

// Check state
printState()

// View results
printResults()

// Export results as JSON
copy(exportResults())
```

**Individual tests:**
```javascript
test_WebSocketConnection()     // WebSocket OK?
test_InsertText()              // Can add text?
test_SimultaneousLocalEdits()  // Concurrent edits?
test_AwarenessClientCount()    // See other users?
test_RapidSequentialInserts()  // 100 inserts OK?
test_LongContentDocument()     // Handle 50 lines?
```

---

## 🔧 Monitoring & Debugging

### Check Server Health
```bash
# All connections
curl http://localhost:3002/metrics

# Quick health check
curl http://localhost:3002/health
```

### Monitor Process
```bash
# Watch connections (updates every 1 sec)
watch 'lsof -i :3002 | grep ESTABLISHED | wc -l'

# Check memory
ps aux | grep collab-service

# Watch logs
tail -f collab.log
```

### Network Inspection
| Check | How | Expected |
|-------|-----|----------|
| WebSocket Connected | DevTools > Network > Filter 'WS' | Status 101 |
| Message Frequency | DevTools > WS Frame Tab | 1-2 msgs/sec |
| Message Size | DevTools > WS > Size column | <1KB typical |
| Latency | Round-trip time in frames | <100ms |

---

## 🐛 Common Issues & Quick Fixes

### 🔴 WebSocket Connection Refused
```javascript
// Check connection status
console.log(provider.status)  // Should be 'connected'

// Verify server running
netstat -an | grep 3002
```
**Fix:** `pnpm --filter=collab-service dev`

### 🟡 Text Not Syncing
```javascript
// Check document
console.log(yText.toString())

// Force update
yText.insert(0, 'TEST')

// Verify received in other browser
console.log(yText.toString())
```
**Fix:** Hard refresh (Ctrl+Shift+R)

### 🔴 Different Text in Two Browsers
```javascript
// Both browsers - check content
console.log(yText.toString())
console.log(yText.length)
```
**Fix:** Restart both services and reconnect

### 🟡 No Remote Cursor Visible
```javascript
// Check awareness
const states = awareness.getStates()
console.log(states.size)  // Should be >1
```
**Fix:** Move cursor in other browser, or refresh

### 🔴 High Latency (>500ms)
- Close other browser tabs
- Check CPU: Task Manager
- Check network: DevTools > Network > Throttling
- Restart services

---

## 📊 Performance Baseline

| Metric | Target | Acceptable | Alert |
|--------|--------|-----------|-------|
| Keystroke Sync | <50ms | <100ms | >200ms |
| Connection Time | <100ms | <500ms | >1000ms |
| Paste 1KB | <200ms | <500ms | >1000ms |
| Paste 10KB | <1000ms | <2000ms | >3000ms |
| Reconnect Time | <2000ms | <5000ms | >10000ms |
| Memory (per session) | <5MB | <50MB | >100MB |

---

## 🎯 Test Scenarios

### Scenario 1: Basic Sync (2 min)
```
1. Browser 1 connects to "session-123"
2. Browser 2 connects to "session-123"
3. B1 types: "function hello()"
4. B2 types: "{ return true; }"
5. Wait 500ms
6. B1 should see: "function hello() { return true; }"
✅ Both editors identical
```

### Scenario 2: Simultaneous Edit (2 min)
```
1. Both browsers on "session-456"
2. Both empty
3. User types in BOTH at same time:
   - B1 types: "HHHEEE" (rapidly)
   - B2 types: "WWW" (rapidly)
4. Wait 1 second
5. Both editors show identical text (either HHHEEEWWW or WWWHHHEEE)
✅ No conflicts, no data loss
```

### Scenario 3: Disconnect Recovery (3 min)
```
1. Both on "session-789"
2. B1 types: "checkpoint-A"
3. B2 types: "checkpoint-B"
4. Both show complete text
5. Stop collab-service (Ctrl+C in Terminal 1)
6. Wait 2 seconds
7. Restart: pnpm --filter=collab-service dev
8. B1 click "Connect"
9. B2 click "Connect"
10. Both show original text
✅ No data loss, smooth recovery
```

### Scenario 4: Performance (5 min)
```
1. Both on "session-perf"
2. B1 console: test_RapidSequentialInserts()
   - 100 writes in <500ms
3. B2 should see all text
4. B1 console: test_LongContentDocument()
   - 50 lines of text
5. B2 should see all 50 lines
6. Memory stable: <50MB for each process
✅ No crashes, responsive editor
```

---

## 🚨 When to Escalate

| Issue | Action |
|-------|--------|
| Test fails consistently | Run full COLLAB_VALIDATION_GUIDE.md |
| 50%+ tests failing | Check auth config (JWT tokens) |
| Memory leak (>500MB) | Check CleanUp code in CollabEditor.tsx |
| Crashes on disconnect | Enable detailed error logging |
| High latency (>500ms) | Network test + CPU profile |

---

## 📝 Test Log Template

```
Date: ____________
Tester: ___________
Browser: __________ (Chrome/Firefox/Safari)
OS: _____________ (Windows/Mac/Linux)

=== RESULTS ===
[ ] Basic Sync ✅/❌
[ ] Conflict Free ✅/❌  
[ ] Disconnect Recovery ✅/❌
[ ] Remote Cursor ✅/❌
[ ] Performance ✅/❌

=== ISSUES ===
Issue: ________________________
Reproducible: Always / Sometimes / Never
Steps: 
1. _____________________
2. _____________________

Error Message: ______________
```

---

## 🔗 Quick Links

- **Full Guide:** [COLLAB_VALIDATION_GUIDE.md](./COLLAB_VALIDATION_GUIDE.md)
- **Test Script:** [TEST_SCRIPT_BROWSER_CONSOLE.js](./TEST_SCRIPT_BROWSER_CONSOLE.js)
- **Metrics:** curl http://localhost:3002/metrics
- **Health:** curl http://localhost:3002/health

---

## 💡 Pro Tips

1. **Incognito Mode:** Use incognito windows for clean state
2. **Side-by-Side:** Arrange browsers side-by-side for easy visual comparison
3. **DevTools:** Keep Network + Console tabs open during testing
4. **Timestamps:** Note exact times of sync for latency verification
5. **Clear Cache:** Hard refresh before each test phase (Ctrl+Shift+R)

---

**Print this card** | **Laminate for durability** | **Share with team**
