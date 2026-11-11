export default {
  "testDir": "/Users/gabrielanokye/Senior Seminar/waypoint/tests/e2e",
  "timeout": 30000,
  "workers": 1,
  "use": {
    "baseURL": "http://127.0.0.1:3199"
  },
  "outputDir": "/Users/gabrielanokye/Senior Seminar/waypoint/docs/verification-runs/weeks-10-12-review-2026-11-10/api-test-results",
  "reporter": "list",
  "webServer": {
    "command": "node '/Users/gabrielanokye/Senior Seminar/waypoint/docs/verification-runs/weeks-10-12-review-2026-11-10/api-smoke-server.mjs'",
    "cwd": "/Users/gabrielanokye/Senior Seminar/waypoint",
    "url": "http://127.0.0.1:3199/health",
    "reuseExistingServer": false,
    "timeout": 30000
  }
};
