import { expect, test } from '@playwright/test';

test('runner health endpoint responds with ok status', async ({ request }) => {
  const response = await request.get('/health');

  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as { status: string; service: string };

  expect(payload.status).toBe('ok');
  expect(payload.service).toBe('runner');
});
