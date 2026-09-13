// Runs inside bp-qa's Playwright process. Raw diagnostics stay in its private
// capture directory; the investigation only receives a separate projection.
const { writeFileSync } = require('node:fs');

module.exports = class CleanupReporter {
  constructor() {
    this.report = { schemaVersion: 1, plannedTests: 0, tests: [], errors: 0, truncated: false, stdout: '', events: [] };
    this.bytes = 0;
  }
  printsToStdio() { return true; }
  onBegin(config, suite) {
    this.report.startedAt = new Date().toISOString();
    this.report.plannedTests = suite.allTests().length;
  }
  onTestEnd(test, result) {
    this.report.tests.push({ id: test.id, file: test.location.file, status: result.status, expectedStatus: test.expectedStatus, retry: result.retry });
  }
  onError() { this.report.errors++; }
  onStdOut(chunk) { this.record('stdout', chunk); }
  onStdErr(chunk) { this.record('stderr', chunk); }
  record(stream, chunk) {
    const text = chunk.toString();
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > 1024 * 1024 || this.report.events.length >= 10000) { this.report.truncated = true; return; }
    this.report.events.push({ stream, receivedAt: new Date().toISOString(), text });
    if (stream === 'stdout') this.report.stdout += text;
  }
  onEnd(result) {
    this.report.status = result.status;
    this.report.endedAt = new Date().toISOString();
    this.report.durationMs = result.duration;
    // Never return a replacement status: this reporter cannot turn a test red
    // or green. A missing file is treated as insufficient evidence by the wrapper.
    writeFileSync(process.env.BEYOND_GREEN_REPORT, JSON.stringify(this.report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
};
