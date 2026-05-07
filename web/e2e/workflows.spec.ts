import { test, expect } from '@playwright/test';

const evidenceDir = '../.sisyphus/evidence/p0-5-p1';

test.describe('Workflow Builder', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-workflows').click();
    await expect(page.getByTestId('workflows-panel')).toBeVisible();
  });

  test('blocks publish for invalid empty workflow', async ({ page }) => {
    await page.getByTestId('workflow-validate').click();
    await expect(page.getByTestId('workflow-validation-errors')).toBeVisible();
    await expect(page.getByTestId('workflow-publish')).toBeDisabled();
    await page.screenshot({ path: `${evidenceDir}/task-3-builder-invalid.png` });
  });

  test('validates missing step name', async ({ page }) => {
    await page.getByTestId('workflow-name-input').fill('Test WF');
    await page.getByTestId('workflow-validate').click();
    await expect(page.getByTestId('workflow-validation-errors')).toBeVisible();
    await expect(page.getByText(/步骤 1 名称不能为空/)).toBeVisible();
  });

  test('validates missing tool name for tool_call step', async ({ page }) => {
    await page.getByTestId('workflow-name-input').fill('Test WF');
    await page.getByTestId('workflow-step-title-0').fill('My Step');
    await page.getByTestId('workflow-validate').click();
    await expect(page.getByTestId('workflow-validation-errors')).toBeVisible();
    await expect(page.getByText(/缺少工具名称/)).toBeVisible();
  });

  test('blocks publish on saved draft without validation', async ({ page }) => {
    await page.getByTestId('workflow-name-input').fill('Unvalidated WF');
    await page.getByTestId('workflow-step-title-0').fill('Step 1');
    await page.getByTestId('workflow-step-toolName-0').fill('status.query');
    await page.getByTestId('workflow-save').click();
    await expect(page.getByTestId('workflow-publish')).toBeDisabled();
  });

  test('creates, reorders, validates, publishes, and runs a workflow', async ({ page }) => {
    await page.getByTestId('workflow-name-input').fill('E2E Workflow');
    await page.getByTestId('workflow-step-title-0').fill('Check status');
    await page.getByTestId('workflow-step-toolName-0').fill('status.query');

    await page.getByTestId('workflow-add-step').click();
    await expect(page.getByTestId('workflow-step-title-1')).toBeVisible();
    await page.getByTestId('workflow-step-title-1').fill('Get health');
    await page.getByTestId('workflow-step-toolName-1').fill('health.check');

    await page.getByTestId('workflow-step-up-1').click();

    await page.getByTestId('workflow-save').click();
    await expect(page.getByTestId('workflow-save')).not.toBeDisabled({ timeout: 5000 });

    await page.getByTestId('workflow-validate').click();
    await expect(page.getByTestId('workflow-publish')).not.toBeDisabled({ timeout: 5000 });

    await page.getByTestId('workflow-publish').click();
    await expect(page.getByTestId('workflow-run')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('workflow-run').click();
    await expect(page.getByTestId('workflow-run-result')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('workflow-run-id')).not.toBeEmpty();
    await expect(page.getByTestId('workflow-run-status')).toBeVisible();

    await page.screenshot({ path: `${evidenceDir}/task-3-builder-happy-path.png` });
  });
});
