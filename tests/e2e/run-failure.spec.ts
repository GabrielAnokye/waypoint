import { expect, test } from '@playwright/test';

test('run with bad workflow id returns 404', async ({ request }) => {
  const resp = await request.post('/workflows/nonexistent_wf/run', { data: {} });
  expect(resp.status()).toBe(404);
});

test('cancel unknown run returns 404', async ({ request }) => {
  const resp = await request.post('/runs/run_nonexistent/cancel');
  expect(resp.status()).toBe(404);
});

test('GET /runs/:id for unknown run returns 404', async ({ request }) => {
  const resp = await request.get('/runs/run_nonexistent');
  expect(resp.status()).toBe(404);
});
