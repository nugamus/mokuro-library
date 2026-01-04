# Backend Performance Logging

This system automatically tracks all API requests and generates detailed performance reports that you can share for optimization analysis.

## 📊 **What Gets Logged**

Every API request automatically records:
- **URL & Method** - Which endpoint was called
- **Duration** - How long it took (in milliseconds)
- **Status Code** - Success/failure (200, 404, 500, etc.)
- **User ID** - Who made the request
- **Query Parameters** - What filters/options were used
- **Request/Response Size** - Data transfer amounts
- **Timestamp** - When it happened
- **Category** - Automatically categorized as:
  - 🟢 **Fast** (< 100ms)
  - 🟡 **Acceptable** (100-500ms)
  - 🟠 **Slow** (500ms-1s)
  - 🔴 **Very Slow** (> 1s)

## 📁 **Where to Find Performance Logs**

Logs are automatically saved to: `logs/performance/`

Two types of files are generated every 5 minutes:

### 1. **Summary Reports** (`summary-{timestamp}.json`)
Human-readable overview with:
- Total requests processed
- Average response time
- Number of slow requests
- Performance breakdown by endpoint
- Top 20 slowest requests

**Example:**
```json
{
  "period": "2025-01-04T10:00:00Z to 2025-01-04T10:05:00Z",
  "totalRequests": 142,
  "averageDuration": 234,
  "slowRequests": 8,
  "fastRequests": 98,
  "byEndpoint": {
    "GET /api/library": {
      "count": 45,
      "avgDuration": 156,
      "maxDuration": 1234,
      "minDuration": 89
    },
    "GET /api/library/volume/:id": {
      "count": 23,
      "avgDuration": 423,
      "maxDuration": 2100,
      "minDuration": 234
    }
  },
  "slowestRequests": [
    {
      "timestamp": "2025-01-04T10:02:34.567Z",
      "method": "GET",
      "url": "/api/library/volume/abc123",
      "duration": 2100,
      "statusCode": 200,
      "userId": "user123",
      "category": "very-slow"
    }
  ]
}
```

### 2. **Detailed Metrics** (`metrics-{timestamp}.json`)
Complete request log with every detail for deep analysis.

## 🔍 **Real-Time Monitoring**

### **Server Console Logs**

Slow requests are logged immediately to the console:

```bash
# Very slow requests (> 1 second)
🔴 VERY SLOW REQUEST: GET /api/library/volume/abc123 {"duration":"2100ms", "statusCode":200}

# Slow requests (500ms - 1 second)
🟠 SLOW REQUEST: GET /api/library?page=1 {"duration":"745ms", "statusCode":200}
```

### **Response Headers**

Every response includes timing information:
```
X-Response-Time: 234ms
```

Check this in browser DevTools → Network tab → Response Headers

## 🎯 **Manual Controls** (Admin Only)

### **Get Live Summary**
```bash
GET /api/performance/summary
```

Returns current performance statistics without waiting for the 5-minute flush.

### **Force Flush to Disk**
```bash
POST /api/performance/flush
```

Immediately writes current metrics to log files.

## 📤 **Sharing Performance Data**

### **Option 1: Send Latest Summary** (Recommended)
1. Navigate to: `logs/performance/`
2. Find the most recent `summary-{timestamp}.json`
3. Send it to me for analysis

### **Option 2: Send Detailed Metrics** (For Deep Dives)
1. Navigate to: `logs/performance/`
2. Find the most recent `metrics-{timestamp}.json`
3. Send it to me - I can analyze patterns and bottlenecks

### **Option 3: Real-Time Snapshot**
As admin user, visit:
```
http://your-site.com/api/performance/summary
```
Copy the JSON and send it to me.

## 🚀 **How It Works**

1. **Automatic Tracking**: Every API request is timed automatically
2. **In-Memory Storage**: Last 10,000 requests kept in memory
3. **Periodic Flushing**: Every 5 minutes, metrics are written to disk
4. **Automatic Cleanup**: Old metrics rotate out to prevent memory issues
5. **Shutdown Safety**: On server shutdown, current metrics are saved

## 🔧 **Configuration**

Performance tracking is **always enabled** and has minimal overhead (< 1ms per request).

To adjust settings, edit `backend/src/plugins/timing.ts`:

```typescript
private maxMetrics = 10000;  // Max metrics in memory
private flushInterval = 5 * 60 * 1000;  // Flush every 5 minutes

categorize(duration: number) {
  if (duration < 100) return 'fast';        // Adjust thresholds
  if (duration < 500) return 'acceptable';
  if (duration < 1000) return 'slow';
  return 'very-slow';
}
```

## 📊 **Interpreting Results**

### **What to Look For**

1. **High Average Duration**
   - If `averageDuration` > 500ms, something is slow overall
   - Check `byEndpoint` to find which routes are slowest

2. **Many Slow Requests**
   - If `slowRequests` > 10% of total, investigate
   - Look at `slowestRequests` array for patterns

3. **Specific Slow Endpoints**
   - Focus on endpoints with `avgDuration` > 500ms
   - Check if `maxDuration` is much higher than `avgDuration` (inconsistent performance)

### **Common Patterns**

**Pattern 1: Library Queries Slow**
```json
"GET /api/library": { "avgDuration": 1200 }
```
➡️ Likely: Large library, missing database indexes, or slow filters

**Pattern 2: Volume Loading Slow**
```json
"GET /api/library/volume/:id": { "avgDuration": 2000 }
```
➡️ Likely: Large OCR data, slow file I/O, or cache misses

**Pattern 3: Inconsistent Performance**
```json
"GET /api/library": {
  "avgDuration": 200,
  "maxDuration": 5000  // Much higher!
}
```
➡️ Likely: Cache cold-starts or database lock contention

## 🐛 **Troubleshooting**

**No log files appearing?**
- Check `logs/performance/` directory exists
- Wait 5 minutes after server start for first flush
- Try hitting `/api/performance/flush` to force a write

**Logs are empty?**
- Make requests to the API (logs only record what happens)
- Check that you're logged in (unauthenticated requests still tracked)

**Can't access `/api/performance/summary`?**
- Must be logged in as admin user
- Check browser console for 403 Forbidden errors

## 💡 **Tips for Best Results**

1. **Reproduce the Issue**: Use the site normally, navigate to slow pages
2. **Wait 5 Minutes**: Let the system collect enough data
3. **Check Summary First**: `summary-*.json` is easier to read
4. **Share Context**: Tell me what actions felt slow
5. **Include Timestamps**: Note when you experienced slowness

## 🎨 **Example Workflow**

1. **You notice slow library loading**
2. **Use the site for 5-10 minutes** (navigate library, open volumes, etc.)
3. **Check `logs/performance/`** for latest summary
4. **Send me** `summary-{latest}.json`
5. **I analyze** and identify: "Library queries taking 2s due to missing index on sortTitle"
6. **I provide fix** (add database index)
7. **You test again** and see `avgDuration` drop to 150ms

## 📈 **Performance Targets**

Based on the logs, we aim for:

| Endpoint | Target Avg | Max Acceptable |
|----------|------------|----------------|
| `GET /api/library` | < 200ms | < 500ms |
| `GET /api/library/series/:id` | < 150ms | < 300ms |
| `GET /api/library/volume/:id` | < 300ms | < 800ms |
| `POST /api/library/upload` | Variable | N/A (file size dependent) |
| `GET /api/files/*` | < 50ms | < 200ms |
| `POST /api/metadata/*` | < 200ms | < 500ms |

If any endpoint consistently exceeds these, send me the logs! 📊
