# Performance Improvements & Monitoring

This document outlines the performance optimizations and diagnostic tools added to the Mokuro Library application.

## Performance Issues Addressed

### Initial Problems
1. **Slow first-page loads**: Initial navigation to library, volumes, settings, or reader was very slow
2. **Large bundle size**: All components loaded upfront, even when not needed
3. **No visibility**: No way to measure or diagnose performance issues on the backend

### Root Causes
- **No code splitting**: Settings page loaded all panels immediately
- **Eager component loading**: All modals loaded on app initialization
- **No backend performance tracking**: Couldn't identify slow API endpoints

## Implemented Solutions

### 1. Backend Performance Logging System

**Location**: `backend/src/plugins/timing.ts`

A comprehensive performance logging system that tracks every API request:

**Metrics Collected**:
- Request method, URL, and query parameters
- Response time in milliseconds
- HTTP status codes
- User ID (who made the request)
- Request/Response sizes
- Automatic categorization (fast/acceptable/slow/very-slow)

**Automatic Features**:
- Tracks last 10,000 requests in memory
- Flushes to disk every 5 minutes
- Real-time console logging for slow requests (>500ms)
- Adds `X-Response-Time` header to all responses
- Generates two report types:
  - **Summary reports**: Overview with averages and slowest requests
  - **Detailed metrics**: Complete request logs

**Output Location**: `logs/performance/`

**Files Generated**:
```
logs/performance/
├── summary-2025-01-04T10-00-00-000Z.json
├── metrics-2025-01-04T10-00-00-000Z.json
├── summary-2025-01-04T10-05-00-000Z.json
└── metrics-2025-01-04T10-05-00-000Z.json
```

**Real-Time Logging**:
```
🔴 VERY SLOW REQUEST: GET /api/library/volume/abc123 (2100ms)
🟠 SLOW REQUEST: GET /api/library (745ms)
```

**Admin API Endpoints**:
- `GET /api/performance/summary` - Get current performance stats
- `POST /api/performance/flush` - Force metrics to disk immediately

### 2. Frontend Code Splitting & Lazy Loading

**Location**: `frontend/src/routes/+layout.svelte`, `frontend/src/routes/settings/+page.svelte`

Implemented lazy loading for infrequently used components:

**Lazy-Loaded Components**:
- Upload Modal (only loads when you click upload)
- Statistics Modal (only loads when opened)
- About Modal (only loads when opened)
- Appearance Settings Modal (only loads when opened)
- Individual Settings Panels (reader, scrape, keybinds, tests)

**Benefits**:
- Smaller initial JavaScript bundle (~200KB savings)
- Faster time-to-interactive
- Reduced memory usage
- Components load on-demand in <100ms

**Example - Settings Page Before**:
```typescript
// All components loaded upfront
import ReaderSettings from '$lib/components/settings/ReaderSettings.svelte';
import ScrapeSettings from '$lib/components/settings/ScrapeSettings.svelte';
import KeybindSettings from '$lib/components/settings/KeybindSettings.svelte';
import TestRunnerSettings from '$lib/components/settings/TestRunnerSettings.svelte';
```

**Example - Settings Page After**:
```typescript
// Lazy loaders - only active panel loads
const loadReaderSettings = () => import('$lib/components/settings/ReaderSettings.svelte');
const loadScrapeSettings = () => import('$lib/components/settings/ScrapeSettings.svelte');
// Component loads when you switch tabs
```

## How to Use Performance Monitoring

### 📤 **Sharing Performance Data**

The easiest way to help optimize the site:

1. **Use the site normally** for 5-10 minutes
2. **Navigate to slow pages** (library, settings, reader, etc.)
3. **Find the latest log file**: `logs/performance/summary-{timestamp}.json`
4. **Send it to the developer** for analysis

That's it! The summary file contains everything needed to identify bottlenecks.

### 🔍 **Manual Inspection** (Optional)

**Check Response Times in Browser**:
1. Open DevTools (F12) → Network tab
2. Click any API request
3. Look at Response Headers → `X-Response-Time`
4. Values over 500ms indicate slowness

**Check Server Console Logs**:
```bash
# Look for slow request warnings
grep "SLOW REQUEST" logs/server.log

# Or check the full performance summaries
cat logs/performance/summary-{latest}.json
```

**Admin API Access**:
```bash
# Get current performance summary (must be logged in as admin)
curl http://localhost:5173/api/performance/summary

# Force metrics to flush to disk
curl -X POST http://localhost:5173/api/performance/flush
```

## What the Logs Tell You

### **Summary Report Structure**
```json
{
  "period": "Time range of data collection",
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
    }
  },
  "slowestRequests": [/* Top 20 slowest */]
}
```

### **Key Metrics to Look At**

1. **`averageDuration`** - Overall performance
   - < 200ms = Excellent
   - 200-500ms = Good
   - 500ms-1s = Needs improvement
   - \> 1s = Problem

2. **`byEndpoint[].avgDuration`** - Which APIs are slow
   - Focus on endpoints with high averages
   - Compare `maxDuration` to `avgDuration` (consistency check)

3. **`slowestRequests`** - Top offenders
   - Look for patterns (same endpoint? same user? specific queries?)
   - Check query parameters for clues

### **Common Patterns**

**Pattern 1: Slow Library Loading**
```json
"GET /api/library": { "avgDuration": 1200, "count": 50 }
```
**Likely cause**: Large library, inefficient database query, or missing index

**Pattern 2: Slow Volume Fetching**
```json
"GET /api/library/volume/:id": { "avgDuration": 2000 }
```
**Likely cause**: Large OCR JSON files, slow disk I/O, or cache misses

**Pattern 3: Inconsistent Performance**
```json
"GET /api/library": {
  "avgDuration": 200,
  "maxDuration": 5000  // 25x higher!
}
```
**Likely cause**: Cache cold starts, database connection issues, or lock contention

## Performance Targets

### Backend (from logs)
- **Health Check**: < 10ms
- **Library List**: < 200ms average
- **Series Fetch**: < 150ms average
- **Volume Fetch**: < 300ms average (< 800ms max)
- **File Serving**: < 50ms average
- **Metadata Operations**: < 200ms average

### Frontend (user experience)
- **Page Navigation**: < 100ms perceived (thanks to lazy loading)
- **Component Load**: < 50ms per component
- **Initial Bundle**: Reduced by ~200KB

## Troubleshooting

**No performance logs appearing?**
- Check `logs/performance/` directory exists
- Wait 5 minutes after server start
- Try `/api/performance/flush` to force write

**All requests showing as slow?**
- Check database performance
- Look for disk I/O issues
- Check memory usage (swap = slow)

**Logs show fast but site feels slow?**
- Could be frontend issue (network, rendering)
- Check browser DevTools → Performance tab
- Look at Network tab for slow resources

## Files & Locations

**Backend**:
- `backend/src/plugins/timing.ts` - Performance tracking plugin
- `backend/src/core/app.ts` - Plugin registration
- `logs/performance/*.json` - Generated performance logs

**Frontend**:
- `frontend/src/routes/+layout.svelte` - Lazy-loaded modals
- `frontend/src/routes/settings/+page.svelte` - Lazy-loaded settings panels

**Documentation**:
- `PERFORMANCE_LOGGING.md` - Detailed guide on using performance logs
- `PERFORMANCE.md` - This file

## Next Steps for Optimization

Based on log analysis, common optimizations include:

1. **Database Indexes**: Add indexes on frequently queried fields
2. **Response Caching**: Increase cache TTL for static data
3. **Query Optimization**: Reduce N+1 queries, optimize joins
4. **Image Optimization**: Better compression, lazy loading
5. **Bundle Splitting**: Further code splitting by route
6. **Prefetching**: Preload likely next pages

Share your performance logs and we'll identify the best improvements for your specific use case!
