/**
 * API Health Check & Monitoring Script
 * Path: /main/api/health.js
 * 
 * Standalone health check module for monitoring Singapore Weather APIs.
 */

export const APIS_TO_MONITOR = [
  {
    id: 'psi',
    name: 'NEA 24-hr PSI API',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
    expectedStatus: 200,
  },
  {
    id: 'pm25',
    name: 'NEA 1-hr PM2.5 API',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
    expectedStatus: 200,
  },
  {
    id: 'rainfall',
    name: 'NEA 5-min Rainfall API',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/rainfall',
    expectedStatus: 200,
  },
  {
    id: 'lightning',
    name: 'MSS Lightning Detection API (LDS)',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning',
    expectedStatus: 200,
  },
  {
    id: 'forecast',
    name: 'NEA 2-hr Weather Forecast API',
    url: 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast',
    expectedStatus: 200,
  },
  {
    id: 'onemap',
    name: 'OneMap Singapore Basemap Tiles',
    url: 'https://www.onemap.gov.sg/maps/tiles/Default/11/1654/1018.png',
    expectedStatus: 200,
  },
];

/**
 * Ping an individual API endpoint and record metrics
 */
export async function checkSingleApi(api, timeoutMs = 6000) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(api.url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, image/png, */*',
        'User-Agent': 'SGWeatherWatch-Monitor/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    const isSuccess = response.status === api.expectedStatus;
    const isRateLimited = response.status === 429;
    const isDegraded = latencyMs > 2500 || isRateLimited;

    let status = 'down';
    let message = `Unexpected HTTP ${response.status}`;

    if (isSuccess) {
      status = isDegraded ? 'degraded' : 'up';
      message = 'Operational';
    } else if (isRateLimited) {
      status = 'degraded';
      message = 'Throttled / Rate limited (HTTP 429)';
    }

    return {
      id: api.id,
      name: api.name,
      url: api.url,
      status,
      httpCode: response.status,
      latencyMs,
      message,
    };
  } catch (error) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const isTimeout = error.name === 'AbortError';

    return {
      id: api.id,
      name: api.name,
      url: api.url,
      status: 'down',
      httpCode: null,
      latencyMs,
      message: isTimeout ? 'Request timed out (>6000ms)' : (error.message || 'Connection error'),
    };
  }
}

/**
 * Run diagnostic checks across all APIs
 */
export async function checkAllApis() {
  const results = await Promise.all(APIS_TO_MONITOR.map((api) => checkSingleApi(api)));
  const downCount = results.filter(r => r.status === 'down').length;
  const degradedCount = results.filter(r => r.status === 'degraded').length;
  const upCount = results.filter(r => r.status === 'up').length;

  const now = new Date();
  const sgtString = now.toLocaleDateString('en-SG', {
    timeZone: 'Asia/Singapore',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' SGT';

  const overallStatus =
    downCount > 2 ? 'unhealthy' : downCount > 0 || degradedCount > 0 ? 'degraded' : 'healthy';

  const avgLatency = Math.round(
    results.reduce((acc, r) => acc + r.latencyMs, 0) / results.length
  );

  return {
    status: overallStatus,
    timestamp: now.toISOString(),
    sgtTime: sgtString,
    summary: {
      total: APIS_TO_MONITOR.length,
      up: upCount,
      degraded: degradedCount,
      down: downCount,
      averageLatencyMs: avgLatency,
    },
    services: results,
  };
}

/**
 * Standard Express / Serverless route handler
 */
export default async function handler(req, res) {
  try {
    const report = await checkAllApis();
    const statusCode = report.status === 'unhealthy' ? 503 : 200;
    
    if (res && typeof res.status === 'function') {
      return res.status(statusCode).json(report);
    }
    return report;
  } catch (err) {
    if (res && typeof res.status === 'function') {
      return res.status(500).json({ error: err.message });
    }
    throw err;
  }
}

// If executed directly from command line (e.g. `node main/api/health.js`)
if (process.argv[1] && process.argv[1].endsWith('health.js')) {
  console.log('Running SG Weather & Haze Watch API Health Monitor from main/api...');
  checkAllApis().then((report) => {
    console.log(`\nOverall Status: ${report.status.toUpperCase()} (${report.sgtTime})`);
    console.log(`Average Latency: ${report.summary.averageLatencyMs}ms\n`);
    console.table(
      report.services.map((s) => ({
        Name: s.name,
        Status: s.status,
        HTTP: s.httpCode ?? 'ERR',
        Latency: `${s.latencyMs}ms`,
        Message: s.message,
      }))
    );
    if (report.status === 'unhealthy') {
      process.exit(1);
    }
  });
}
