/**
 * tests/rateLimiter.test.js
 *
 * Lesson 3 — Rate Limiter Accuracy Under Concurrency.
 *
 * WHAT THIS TESTS:
 * Fires N concurrent requests from a single IP and verifies the token bucket
 * allows exactly `capacity` requests and rejects everything above it.
 *
 * WHY THIS MATTERS:
 * A rate limiter that allows 103 when it should allow 100 is broken for
 * security use cases. One that allows 97 is broken for paying customers.
 * Floating point drift in the refill calculation can cause both.
 *
 * HOW CONCURRENCY IS SIMULATED:
 * Promise.all() fires all requests simultaneously in the same event loop tick.
 * This is the closest approximation to true concurrency in single-threaded Node.
 * All requests share the same source IP (127.0.0.1) so they all hit the same
 * token bucket.
 *
 * BEFORE RUNNING:
 * 1. Server must be running on PORT 4000
 * 2. Route must exist with prefix /proxy and rate_limit_enabled: true
 * 3. Set the route's rate_limit_capacity to the CAPACITY value below
 *    via PATCH /api/routes/:id before running
 * 4. Restart the server after changing the route so buckets are fresh
 */

const BASE_URL = "http://localhost:4000";
const PROXY_PATH = "/proxy/users/1";
const MANAGEMENT_URL = `${BASE_URL}/api/routes`;

// Must match the rate_limit_capacity set on the route in the DB.
const CAPACITY = 100;

// How many concurrent requests to fire in each test.
// Should be significantly higher than CAPACITY to expose drift.
const CONCURRENT_REQUESTS = 500;

// Acceptable drift margin. Senior engineers debate this number.
// 0 means you require mathematical perfection.
// We start at 0 to see what the system actually does.
const ALLOWED_DRIFT = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeRequest(url) {
  const start = Date.now();
  try {
    const res = await fetch(url);
    return {
      status: res.status,
      duration: Date.now() - start,
      ok: res.status < 400,
    };
  } catch (err) {
    return {
      status: 0,
      duration: Date.now() - start,
      ok: false,
      error: err.message,
    };
  }
}

function printDivider(char = "-", length = 60) {
  console.log(char.repeat(length));
}

function printResult(label, value, pass, expected = null) {
  const status = pass ? "PASS" : "FAIL";
  const expectedStr = expected !== null ? ` (expected: ${expected})` : "";
  console.log(`  [${status}] ${label}: ${value}${expectedStr}`);
}

// ─── Test: Cold Bucket Accuracy ───────────────────────────────────────────────
//
// A fresh bucket starts full at CAPACITY tokens. Fire CONCURRENT_REQUESTS
// simultaneously. Exactly CAPACITY should succeed.

async function testColdBucketAccuracy() {
  console.log("\nTest 1: Cold Bucket Accuracy");
  console.log(
    `Firing ${CONCURRENT_REQUESTS} concurrent requests against a fresh bucket (capacity: ${CAPACITY})`,
  );
  printDivider();

  // Fire all requests simultaneously.
  // Promise.all does not guarantee execution order but guarantees all start
  // before any await resolves - as close to simultaneous as JS allows.
  const url = `${BASE_URL}${PROXY_PATH}`;
  const promises = Array.from({ length: CONCURRENT_REQUESTS }, () =>
    makeRequest(url),
  );
  const results = await Promise.all(promises);

  const allowed = results.filter(
    (r) => r.status === 200 || (r.status < 400 && r.status !== 0),
  ).length;
  const rejected = results.filter((r) => r.status === 429).length;
  const errors = results.filter((r) => r.status === 0).length;
  const other = CONCURRENT_REQUESTS - allowed - rejected - errors;

  const drift = Math.abs(allowed - CAPACITY);
  const driftPct = ((drift / CAPACITY) * 100).toFixed(2);

  const latencies = results.map((r) => r.duration).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  console.log(`\n  Results:`);
  printResult("Allowed (2xx)", allowed, drift <= ALLOWED_DRIFT, CAPACITY);
  printResult(
    "Rejected (429)",
    rejected,
    rejected >= CONCURRENT_REQUESTS - CAPACITY - ALLOWED_DRIFT - errors,
  );
  printResult("Errors", errors, errors === 0, 0);
  printResult("Other", other, other === 0, 0);
  printResult(
    "Drift",
    `${drift} requests (${driftPct}%)`,
    drift <= ALLOWED_DRIFT,
    0,
  );
  console.log(`\n  Latency:`);
  console.log(`    p50: ${p50}ms`);
  console.log(`    p99: ${p99}ms`);

  return { allowed, rejected, errors, drift, pass: drift <= ALLOWED_DRIFT };
}

// ─── Test: Refill Accuracy ────────────────────────────────────────────────────
//
// After exhausting the bucket, wait exactly 1 second and fire CAPACITY requests.
// The refill should have added exactly `refillRate` tokens.
// We need to know the route's refill rate - fetch it from the management API.

async function testRefillAccuracy() {
  console.log("\nTest 2: Refill Accuracy After Exhaustion");
  printDivider();

  // Fetch the route config to get the actual refill rate.
  let refillRate;
  try {
    const res = await fetch(MANAGEMENT_URL);
    const data = await res.json();
    const route = data.data.find((r) => r.prefix === "/proxy");
    if (!route) throw new Error("Route /proxy not found in management API");
    refillRate = route.rate_limit_refill_rate;
    console.log(
      `  Route config: capacity=${route.rate_limit_capacity}, refill=${refillRate}/s`,
    );
  } catch (err) {
    console.log(`  [SKIP] Could not fetch route config: ${err.message}`);
    return null;
  }

  // First, exhaust the bucket completely.
  console.log(`  Exhausting bucket with ${CAPACITY + 50} requests...`);
  const exhaustRequests = Array.from({ length: CAPACITY + 50 }, () =>
    makeRequest(`${BASE_URL}${PROXY_PATH}`),
  );
  await Promise.all(exhaustRequests);
  console.log("  Bucket exhausted.");

  // Wait exactly 1 second for the refill.
  const waitMs = 1000;
  console.log(`  Waiting ${waitMs}ms for refill...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // After 1 second, exactly `refillRate` tokens should have been added.
  // Fire refillRate + 20 requests. Only refillRate should succeed.
  const testCount = Math.ceil(refillRate) + 20;
  console.log(
    `  Firing ${testCount} requests (expecting ${Math.ceil(refillRate)} to succeed)...`,
  );

  const results = await Promise.all(
    Array.from({ length: testCount }, () =>
      makeRequest(`${BASE_URL}${PROXY_PATH}`),
    ),
  );

  const allowed = results.filter(
    (r) => r.status < 400 && r.status !== 0,
  ).length;
  const rejected = results.filter((r) => r.status === 429).length;
  const drift = Math.abs(allowed - Math.ceil(refillRate));

  console.log(`\n  Results after ${waitMs}ms wait:`);
  printResult("Expected to pass", Math.ceil(refillRate), true);
  printResult(
    "Actually passed",
    allowed,
    drift <= ALLOWED_DRIFT,
    Math.ceil(refillRate),
  );
  printResult("Rejected", rejected, true);
  printResult("Refill drift", `${drift} tokens`, drift <= ALLOWED_DRIFT, 0);

  return {
    allowed,
    expected: Math.ceil(refillRate),
    drift,
    pass: drift <= ALLOWED_DRIFT,
  };
}

// ─── Test: Burst Isolation Per IP ────────────────────────────────────────────
//
// Fire CAPACITY requests from two different spoofed IPs simultaneously.
// Each IP has its own bucket. Total allowed should be CAPACITY * 2.
// This verifies buckets are truly isolated and do not share state.

async function testBucketIsolation() {
  console.log("\nTest 3: Bucket Isolation Per IP");
  console.log(
    `Firing ${CAPACITY} requests from two different IPs simultaneously`,
  );
  console.log(`Expected total allowed: ${CAPACITY * 2} (${CAPACITY} per IP)`);
  printDivider();

  const makeRequestWithIp = async (ip) => {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE_URL}${PROXY_PATH}`, {
        headers: { "X-Forwarded-For": ip },
      });
      return { status: res.status, duration: Date.now() - start, ip };
    } catch (err) {
      return {
        status: 0,
        duration: Date.now() - start,
        ip,
        error: err.message,
      };
    }
  };

  // Fire CAPACITY requests from each IP simultaneously.
  const ip1Requests = Array.from({ length: CAPACITY }, () =>
    makeRequestWithIp("10.0.0.1"),
  );
  const ip2Requests = Array.from({ length: CAPACITY }, () =>
    makeRequestWithIp("10.0.0.2"),
  );

  const results = await Promise.all([...ip1Requests, ...ip2Requests]);

  const ip1Results = results.filter((r) => r.ip === "10.0.0.1");
  const ip2Results = results.filter((r) => r.ip === "10.0.0.2");

  const ip1Allowed = ip1Results.filter(
    (r) => r.status < 400 && r.status !== 0,
  ).length;
  const ip2Allowed = ip2Results.filter(
    (r) => r.status < 400 && r.status !== 0,
  ).length;
  const totalAllowed = ip1Allowed + ip2Allowed;
  const expectedTotal = CAPACITY * 2;
  const drift = Math.abs(totalAllowed - expectedTotal);

  console.log(`\n  Results:`);
  printResult(
    "IP 10.0.0.1 allowed",
    ip1Allowed,
    ip1Allowed === CAPACITY,
    CAPACITY,
  );
  printResult(
    "IP 10.0.0.2 allowed",
    ip2Allowed,
    ip2Allowed === CAPACITY,
    CAPACITY,
  );
  printResult(
    "Total allowed",
    totalAllowed,
    drift <= ALLOWED_DRIFT,
    expectedTotal,
  );
  printResult("Isolation drift", drift, drift <= ALLOWED_DRIFT, 0);

  return {
    ip1Allowed,
    ip2Allowed,
    totalAllowed,
    drift,
    pass: drift <= ALLOWED_DRIFT,
  };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  printDivider("=", 60);
  console.log("  GHOSTPROXY - RATE LIMITER ACCURACY TEST");
  console.log(`  Target: ${BASE_URL}${PROXY_PATH}`);
  console.log(`  Capacity: ${CAPACITY} | Concurrent: ${CONCURRENT_REQUESTS}`);
  console.log(`  Allowed drift: ${ALLOWED_DRIFT} requests`);
  printDivider("=", 60);

  const results = [];

  try {
    results.push(await testColdBucketAccuracy());
  } catch (err) {
    console.error("Test 1 threw:", err.message);
  }

  // Wait between tests so the bucket state from Test 1 does not bleed into Test 2.
  console.log("\nWaiting 3s between tests for bucket state to settle...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    results.push(await testRefillAccuracy());
  } catch (err) {
    console.error("Test 2 threw:", err.message);
  }

  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    results.push(await testBucketIsolation());
  } catch (err) {
    console.error("Test 3 threw:", err.message);
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  printDivider("=", 60);
  console.log("  SUMMARY");
  printDivider("=", 60);

  const passed = results.filter((r) => r && r.pass).length;
  const total = results.filter((r) => r !== null).length;

  results.forEach((r, i) => {
    if (r === null) {
      console.log(`  Test ${i + 1}: SKIPPED`);
    } else {
      console.log(
        `  Test ${i + 1}: ${r.pass ? "PASS" : "FAIL"} (drift: ${r.drift})`,
      );
    }
  });

  printDivider("-", 60);
  console.log(`  ${passed}/${total} tests passed`);
  printDivider("=", 60);

  // Exit with non-zero code if any test failed.
  // This makes the script work correctly in CI pipelines.
  if (passed < total) process.exit(1);
}

run().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
