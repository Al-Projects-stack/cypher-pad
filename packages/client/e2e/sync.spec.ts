import { expect, test } from '@playwright/test';

const PASSWORD = 'e2e test passphrase value';
const EMAIL = 'e2e@example.com';
const API = 'http://localhost:3001';

test('write on A syncs to B then offline edits keep a conflict copy', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await pageA.goto('/');
  await pageA.getByTestId('password').fill(PASSWORD);
  await pageA.getByTestId('password-repeat').fill(PASSWORD);
  await pageA.getByTestId('vault-submit').click();
  await pageA.getByTestId('note-new').waitFor({ timeout: 60000 });

  await pageA.getByTestId('sync-url').fill(API);
  await pageA.getByTestId('sync-email').fill(EMAIL);
  await pageA.getByTestId('sync-password').fill(PASSWORD);
  await pageA.getByTestId('sync-register').click();
  await expect(pageA.getByTestId('sync-status')).toContainText('Linked as', { timeout: 60000 });

  await pageA.getByTestId('note-new').click();
  await pageA.getByTestId('note-title').fill('Shared note');
  await pageA.getByTestId('note-body').fill('written on device A');
  await pageA.getByTestId('note-save').click();
  await pageA.getByTestId('sync-now').click();
  await expect(pageA.getByTestId('sync-status')).toContainText('1 pushed', { timeout: 60000 });

  await pageB.goto('/');
  await pageB.getByTestId('sync-url').fill(API);
  await pageB.getByTestId('sync-email').fill(EMAIL);
  await pageB.getByTestId('sync-password').fill(PASSWORD);
  await pageB.getByTestId('sync-login').click();
  await pageB.getByTestId('note-new').waitFor({ timeout: 90000 });
  await pageB.getByTestId('sync-now').click();
  await expect(pageB.getByText('Shared note', { exact: true })).toBeVisible({ timeout: 60000 });

  await ctxA.setOffline(true);
  await ctxB.setOffline(true);

  await pageA.getByText('Shared note', { exact: true }).click();
  await pageA.getByTestId('note-body').fill('edit from device A');
  await pageA.getByTestId('note-save').click();

  await pageB.getByText('Shared note', { exact: true }).click();
  await pageB.getByTestId('note-body').fill('edit from device B');
  await pageB.getByTestId('note-save').click();

  await ctxA.setOffline(false);
  await ctxB.setOffline(false);

  await pageA.getByTestId('sync-now').click();
  await expect(pageA.getByTestId('sync-status')).toContainText('Synced', { timeout: 60000 });

  await pageB.getByTestId('sync-now').click();
  await expect(pageB.getByText('conflict copy')).toBeVisible({ timeout: 60000 });

  await pageB.getByText('Shared note', { exact: true }).click();
  await expect(pageB.getByTestId('note-body')).toHaveValue('edit from device B', { timeout: 30000 });

  await pageB.getByText('Shared note (conflict copy)').click();
  await expect(pageB.getByTestId('note-body')).toHaveValue('edit from device A', { timeout: 30000 });

  await ctxA.close();
  await ctxB.close();
});
