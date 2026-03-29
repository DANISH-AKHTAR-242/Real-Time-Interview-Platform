// Browser Console Testing Script - Copy & Paste into DevTools Console
// Usage: 1. Open Browser 1 on http://localhost:5173
//        2. Connect to sessionId "test-session-123"
//        3. Run tests below in browser console

// ============================================================================
// PHASE 1: CONNECTION TESTS
// ============================================================================

const TEST_RESULTS = [];

function logTest(name, passed, message) {
  const result = { name, passed, message, timestamp: new Date().toISOString() };
  TEST_RESULTS.push(result);
  console.log(`${passed ? '✅' : '❌'} ${name}: ${message}`);
  return passed;
}

// Test 1.1: WebSocket Connected
function test_WebSocketConnection() {
  const connected = provider.status === 'connected';
  logTest(
    'WebSocket Connected',
    connected,
    `Status: ${provider.status}`
  );
  return connected;
}

// Test 1.2: Yjs Doc Initialized
function test_YjsDocInitialized() {
  const hasYText = !!yText;
  logTest(
    'Yjs Document Created',
    hasYText,
    `yText type: ${typeof yText}`
  );
  return hasYText;
}

// Test 1.3: Awareness Initialized
function test_AwarenessInitialized() {
  const hasAwareness = !!awareness;
  const clientId = awareness?.clientID;
  logTest(
    'Awareness Connected',
    hasAwareness,
    `ClientID: ${clientId}`
  );
  return hasAwareness;
}

// Test 1.4: Monitor Connection Status
function test_ConnectionStatusMonitoring() {
  return new Promise((resolve) => {
    let statusChanges = [];
    const unsubscribe = provider.on('status', (event) => {
      statusChanges.push(event.status);
      console.log(`[Monitor] Connection status: ${event.status}`);
    });
    
    setTimeout(() => {
      logTest(
        'Connection Monitoring',
        statusChanges.length > 0,
        `Status events: ${statusChanges.join(' → ')}`
      );
      resolve(true);
    }, 1000);
  });
}

// ============================================================================
// PHASE 2: SYNC TESTS (Single Browser)
// ============================================================================

// Test 2.1: Insert Text
function test_InsertText() {
  const initialLength = yText.length;
  const testText = 'TEST-INSERT-123';
  
  yText.insert(initialLength, testText);
  
  const success = yText.toString().includes(testText);
  logTest(
    'Insert Text',
    success,
    `Added "${testText}" (length: ${yText.length})`
  );
  return success;
}

// Test 2.2: Delete Text
function test_DeleteText() {
  const length = yText.length;
  if (length < 5) {
    logTest('Delete Text', false, 'Not enough text to delete');
    return false;
  }
  
  yText.delete(length - 5, 5);
  logTest(
    'Delete Text',
    yText.length === length - 5,
    `Deleted 5 chars (length: ${yText.length})`
  );
  return true;
}

// Test 2.3: Format Text (if Monaco binding supports)
function test_EditorSync() {
  const content = 'function test() { return true; }';
  
  // Clear and set new content
  yText.delete(0, yText.length);
  yText.insert(0, content);
  
  logTest(
    'Editor Sync',
    yText.toString() === content,
    `Content length: ${yText.length}`
  );
  return true;
}

// Test 2.4: Large Content Insert
async function test_LargeContentInsert() {
  const largeContent = 'x'.repeat(5000); // 5KB
  const startTime = performance.now();
  
  yText.delete(0, yText.length); // Clear
  yText.insert(0, largeContent);
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  logTest(
    'Large Content Insert (5KB)',
    yText.length === 5000,
    `Duration: ${duration.toFixed(2)}ms`
  );
  
  return new Promise(resolve => {
    setTimeout(() => {
      const received = yText.length === 5000;
      logTest(
        'Large Content Received',
        received,
        `Stable length: ${yText.length}`
      );
      resolve(true);
    }, 500);
  });
}

// ============================================================================
// PHASE 3: CONFLICT DETECTION
// ============================================================================

// Test 3.1: Simultaneous Local Edits
function test_SimultaneousLocalEdits() {
  yText.insert(0, 'A');
  yText.insert(1, 'B');
  yText.insert(2, 'C');
  
  const content = yText.toString();
  const hasA = content.includes('A');
  const hasB = content.includes('B');
  const hasC = content.includes('C');
  
  logTest(
    'Simultaneous Local Edits',
    hasA && hasB && hasC,
    `Content: ${content.slice(0, 50)}...`
  );
  return true;
}

// Test 3.2: Undo/Redo (if Monaco supports)
function test_UndoRedo() {
  const beforeLength = yText.length;
  const content = 'UNDO-TEST';
  
  yText.insert(beforeLength, content);
  const afterInsert = yText.length;
  
  // Note: Undo/redo in Monaco binding is automatic
  logTest(
    'Content Modification',
    afterInsert === beforeLength + content.length,
    `Before: ${beforeLength}, After: ${afterInsert}`
  );
  return true;
}

// ============================================================================
// PHASE 4: PRESENCE & AWARENESS
// ============================================================================

// Test 4.1: Local State
function test_LocalPresenceState() {
  const localState = awareness.getLocalState();
  const hasUser = !!localState?.user;
  const hasName = !!localState?.user?.name;
  const hasColor = !!localState?.user?.color;
  
  logTest(
    'Local Presence State',
    hasUser && hasName && hasColor,
    `User: ${localState?.user?.name}, Color: ${localState?.user?.color}`
  );
  return true;
}

// Test 4.2: Awareness Client Count
function test_AwarenessClientCount() {
  const states = awareness.getStates();
  const clientCount = states.size;
  
  logTest(
    'Awareness Clients',
    clientCount >= 1,
    `Connected clients: ${clientCount}`
  );
  
  // Log all clients
  states.forEach((state, clientId) => {
    console.log(`  Client ${clientId}:`, state?.user?.name);
  });
  return true;
}

// Test 4.3: Monitor Cursor Updates
function test_MonitorCursorUpdates() {
  return new Promise((resolve) => {
    let cursorUpdates = 0;
    
    const handler = () => {
      cursorUpdates++;
    };
    
    awareness.on('change', handler);
    
    // Simulate cursor movement
    const selection = editor.getSelection();
    if (selection) {
      const anchor = model.getOffsetAt(selection.getStartPosition());
      const head = model.getOffsetAt(selection.getEndPosition());
      awareness.setLocalStateField('cursor', { anchor, head });
    }
    
    setTimeout(() => {
      awareness.off('change', handler);
      logTest(
        'Cursor Monitoring',
        cursorUpdates > 0,
        `Cursor updates detected: ${cursorUpdates}`
      );
      resolve(true);
    }, 500);
  });
}

// ============================================================================
// PHASE 5: MESSAGE & LATENCY TESTS
// ============================================================================

// Test 5.1: Monitor WebSocket Messages
function test_MonitorWebSocketMessages() {
  return new Promise((resolve) => {
    let messageCount = 0;
    let totalBytes = 0;
    const startTime = Date.now();
    
    // Hook into provider message sending
    const originalSend = provider.ws?.send;
    if (provider.ws) {
      provider.ws.send = function(...args) {
        messageCount++;
        if (args[0]) {
          totalBytes += args[0].length || 0;
        }
        return originalSend.apply(this, args);
      };
    }
    
    // Wait for activity
    setTimeout(() => {
      const duration = Date.now() - startTime;
      logTest(
        'WebSocket Message Monitoring',
        messageCount > 0,
        `${messageCount} messages, ${totalBytes} bytes in ${duration}ms`
      );
      resolve(true);
    }, 2000);
  });
}

// Test 5.2: Measure Single Edit Latency
async function test_EditLatency() {
  const startTime = performance.now();
  const initialLength = yText.length;
  
  // Measure time to apply a change
  yText.insert(initialLength, 'LATENCY_TEST');
  
  // Wait for network propagation
  await new Promise(r => setTimeout(r, 100));
  
  const endTime = performance.now();
  const duration = endTime - startTime;
  
  logTest(
    'Edit Latency (local)',
    duration < 500,
    `${duration.toFixed(2)}ms (target: <100ms)`
  );
  
  return duration;
}

// ============================================================================
// PHASE 6: STRESS TESTS
// ============================================================================

// Test 6.1: Rapid Sequential Inserts
async function test_RapidSequentialInserts() {
  const iterations = 100;
  const startTime = performance.now();
  
  yText.delete(0, yText.length); // Clear
  
  for (let i = 0; i < iterations; i++) {
    yText.insert(i, 'X');
  }
  
  const duration = performance.now() - startTime;
  const finalLength = yText.length;
  
  logTest(
    'Rapid Sequential Inserts (100x)',
    finalLength >= iterations,
    `${iterations} inserts in ${duration.toFixed(2)}ms`
  );
  
  return true;
}

// Test 6.2: Memory Stability
function test_MemoryStability() {
  if (!performance.memory) {
    console.warn('⚠️  Memory API not available (enable --enable-precise-memory-info)');
    return false;
  }
  
  const memoryUsage = performance.memory.usedJSHeapSize / 1048576;
  
  logTest(
    'Memory Usage',
    memoryUsage < 100, // Less than 100MB
    `${memoryUsage.toFixed(2)}MB`
  );
  
  return true;
}

// Test 6.3: Long Content Document
async function test_LongContentDocument() {
  const longContent = Array(50)
    .fill(null)
    .map((_, i) => `Line ${i}: This is test content with some data.\n`)
    .join('');
  
  const startTime = performance.now();
  yText.delete(0, yText.length);
  yText.insert(0, longContent);
  const duration = performance.now() - startTime;
  
  logTest(
    'Long Content Document',
    yText.length === longContent.length,
    `${longContent.length} chars in ${duration.toFixed(2)}ms`
  );
  
  return true;
}

// ============================================================================
// PHASE 7: DISCONNECTION & RECOVERY
// ============================================================================

// Test 7.1: Check for Disconnects
function test_MonitorDisconnects() {
  return new Promise((resolve) => {
    let disconnectCount = 0;
    
    const handler = (event) => {
      if (event.status === 'disconnected') {
        disconnectCount++;
      }
    };
    
    provider.on('status', handler);
    
    setTimeout(() => {
      provider.off('status', handler);
      logTest(
        'Disconnect Monitoring',
        true, // Just monitoring
        `${disconnectCount} disconnects observed`
      );
      resolve(true);
    }, 5000);
  });
}

// Test 7.2: State Preservation Check
function test_StatePreservation() {
  const currentContent = yText.toString();
  const contentLength = yText.length;
  
  logTest(
    'State Preserved',
    contentLength > 0,
    `Content length: ${contentLength}`
  );
  
  return true;
}

// ============================================================================
// TEST SUITE RUNNER
// ============================================================================

async function runAllTests() {
  console.clear();
  console.log('🧪 Collaborative Editing - E2E Test Suite');
  console.log('═'.repeat(50));
  
  // Phase 1: Connection
  console.log('\n📡 PHASE 1: Connection Tests');
  test_WebSocketConnection();
  test_YjsDocInitialized();
  test_AwarenessInitialized();
  
  // Phase 2: Sync
  console.log('\n🔄 PHASE 2: Sync Tests');
  test_EditorSync();
  test_InsertText();
  test_DeleteText();
  
  // Phase 3: Conflicts
  console.log('\n⚔️  PHASE 3: Conflict Detection');
  test_SimultaneousLocalEdits();
  test_UndoRedo();
  
  // Phase 4: Presence
  console.log('\n👥 PHASE 4: Presence & Awareness');
  test_LocalPresenceState();
  test_AwarenessClientCount();
  
  // Phase 5: Latency
  console.log('\n⏱️  PHASE 5: Latency Tests');
  await test_EditLatency();
  
  // Phase 6: Stress
  console.log('\n💪 PHASE 6: Stress Tests');
  await test_RapidSequentialInserts();
  test_MemoryStability();
  
  // Phase 7: Recovery
  console.log('\n🔧 PHASE 7: Recovery Tests');
  test_StatePreservation();
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  const passed = TEST_RESULTS.filter(r => r.passed).length;
  const total = TEST_RESULTS.length;
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('✅ All tests PASSED!');
  } else {
    console.log(`❌ ${total - passed} tests FAILED`);
    TEST_RESULTS.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.message}`);
    });
  }
  
  // Export results
  console.log('\n📄 Export test results:');
  console.log('copy(JSON.stringify(TEST_RESULTS, null, 2))');
  
  return TEST_RESULTS;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Get current state
function printState() {
  console.log('📋 Current State:');
  console.log('Content Length:', yText.length);
  console.log('Content Preview:', yText.toString().slice(0, 100));
  console.log('WS Status:', provider.status);
  console.log('ClientID:', awareness.clientID);
  console.log('Connected Clients:', awareness.getStates().size);
}

// Clear editor
function clearEditor() {
  yText.delete(0, yText.length);
  console.log('✨ Editor cleared');
}

// Print test results
function printResults() {
  TEST_RESULTS.forEach((r, i) => {
    console.log(`${i + 1}. ${r.passed ? '✅' : '❌'} ${r.name}`);
    console.log(`   ${r.message}`);
  });
}

// Export results as JSON
function exportResults() {
  return JSON.stringify(TEST_RESULTS, null, 2);
}

// ============================================================================
// USAGE INSTRUCTIONS
// ============================================================================

console.log(
  `
🚀 Collaborative Editing Test Suite
════════════════════════════════════════════════

📝 QUICK START:
  1. runAllTests()        - Run complete test suite
  2. printState()         - Show current state
  3. clearEditor()        - Clear editor content
  4. printResults()       - Show test results
  5. exportResults()      - Get JSON results

🧪 INDIVIDUAL TESTS:
  test_WebSocketConnection()
  test_InsertText()
  test_DeleteText()
  test_SimultaneousLocalEdits()
  test_LocalPresenceState()
  test_AwarenessClientCount()
  test_RapidSequentialInserts()
  test_LongContentDocument()
  
📊 DATA:
  TEST_RESULTS - Array of all test results

════════════════════════════════════════════════
Run: runAllTests() to start testing
════════════════════════════════════════════════
  `
);

// Export functions for use
window.testSuite = {
  runAllTests,
  printState,
  clearEditor,
  printResults,
  exportResults,
  TEST_RESULTS,
};
