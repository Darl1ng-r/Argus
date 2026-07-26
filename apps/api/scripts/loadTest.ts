import autocannon from 'autocannon';
import { app } from '../src/server.js';
import { Server } from 'http';

/**
 * Autocannon Load & Stress Testing Script
 * Simulates high-concurrency traffic (50 connections over 5 seconds)
 * against Argus API endpoints to measure throughput and latency percentiles.
 */
async function runLoadTest() {
  const TEST_PORT = 4099;
  let server: Server | null = null;

  try {
    server = app.listen(TEST_PORT);
  } catch {
    // Already running server fallback
  }

  const targetUrl = `http://localhost:${TEST_PORT}`;

  console.log(`\n⚡ Starting Autocannon Load & Stress Test against ${targetUrl}...`);
  console.log(`   Concurrent Connections: 50 | Duration: 5 seconds\n`);

  autocannon(
    {
      url: `${targetUrl}/api/link-preview?url=https://example.com`,
      connections: 50,
      duration: 5,
      headers: {
        'Accept': 'application/json',
      },
    },
    (err, result) => {
      if (server) server.close();

      if (err) {
        console.error('❌ Load test failed:', err);
        process.exit(1);
      }

      console.log('===================================================');
      console.log('📊 ARGUS API LOAD TEST RESULTS');
      console.log('===================================================');
      console.log(`Requests/sec:   ${result.requests.average.toFixed(2)} req/sec`);
      console.log(`Throughput:     ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/sec`);
      console.log(`Latency (p50):  ${result.latency.p50} ms`);
      console.log(`Latency (p90):  ${result.latency.p90 || result.latency.p99} ms`);
      console.log(`Latency (p99):  ${result.latency.p99} ms`);
      console.log(`Total Requests: ${result.requests.total}`);
      console.log(`Total Errors:   ${result.errors}`);
      console.log('===================================================\n');
      process.exit(0);
    }
  );
}

runLoadTest();
