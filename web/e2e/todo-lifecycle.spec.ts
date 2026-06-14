import { test, expect } from '@playwright/test';

test.describe('Todo Lifecycle E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Navigate to todos tab
    await page.getByTestId('tab-todos').click();
    await expect(page.getByTestId('todos-panel')).toBeVisible();
  });

  test('should create a root todo via UI', async ({ page }) => {
    // Click create button
    await page.getByTestId('todo-create-btn').click();
    await expect(page.getByTestId('todo-create-form')).toBeVisible();

    // Fill in todo content
    const contentInput = page.getByTestId('todo-content-input');
    await contentInput.fill('E2E Root Todo Task');

    // Submit
    await page.getByTestId('todo-submit-btn').click();

    // Wait for form to close and todo to appear
    await expect(page.getByTestId('todo-create-form')).not.toBeVisible();

    // Verify todo appears in tree
    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Root Todo Task');
  });

  test('should create nested child todos up to depth 3', async ({ page }) => {
    // Create root todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Parent Todo');
    await page.getByTestId('todo-submit-btn').click();

    // Wait for todo to appear and get its row
    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Parent Todo');

    // Find the parent todo row and click add child
    const parentRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Parent Todo' });
    const addChildBtn = parentRow.getByTestId(/todo-add-child-/);
    await addChildBtn.click();

    // Create depth-1 child
    await expect(page.getByTestId('todo-create-form')).toBeVisible();
    await page.getByTestId('todo-content-input').fill('E2E Child Level 1');
    await page.getByTestId('todo-submit-btn').click();

    // Wait for child to appear
    await expect(todoTree).toContainText('E2E Child Level 1');

    // Create depth-2 child (grandchild)
    const childRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Child Level 1' });
    await childRow.getByTestId(/todo-add-child-/).click();
    await page.getByTestId('todo-content-input').fill('E2E Child Level 2');
    await page.getByTestId('todo-submit-btn').click();

    // Wait for grandchild to appear
    await expect(todoTree).toContainText('E2E Child Level 2');

    // Create depth-3 child (great-grandchild - this should be the last allowed depth)
    const grandchildRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Child Level 2' });
    await grandchildRow.getByTestId(/todo-add-child-/).click();
    await page.getByTestId('todo-content-input').fill('E2E Child Level 3');
    await page.getByTestId('todo-submit-btn').click();

    // Wait for great-grandchild to appear
    await expect(todoTree).toContainText('E2E Child Level 3');
  });

  test('should reject depth 4 (no add child button at depth 3)', async ({ page }) => {
    // Create a depth-3 nested structure via API (faster than UI clicks)
    // First create root todo via UI
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Depth Test Parent');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Depth Test Parent');

    // Get the parent todo's todoId from the row's testid
    const parentRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Depth Test Parent' });
    const parentRowTestId = await parentRow.getAttribute('data-testid');
    // Format: todo-row-{todoId}
    const parentTodoId = parentRowTestId?.replace('todo-row-', '') || '';

    // Create children via API to speed up
    // We'll use the request context
    const response1 = await page.request.post('/api/v1/todos', {
      data: {
        content: 'E2E Child L1',
        parentTodoId,
      },
    });
    const child1 = await response1.json();
    const child1Id = child1.todo?.todoId || child1.data?.todo?.todoId;

    const response2 = await page.request.post('/api/v1/todos', {
      data: {
        content: 'E2E Child L2',
        parentTodoId: child1Id,
      },
    });
    const child2 = await response2.json();
    const child2Id = child2.todo?.todoId || child2.data?.todo?.todoId;

    const response3 = await page.request.post('/api/v1/todos', {
      data: {
        content: 'E2E Child L3 (MAX DEPTH)',
        parentTodoId: child2Id,
      },
    });

    // Refresh the page to load new todos
    await page.reload();
    await page.getByTestId('tab-todos').click();
    await expect(page.getByTestId('todos-panel')).toBeVisible();

    // Find the depth-3 todo (great-grandchild)
    const depth3Row = page.getByTestId('todo-tree').locator('.todo-row').filter({
      hasText: 'E2E Child L3 (MAX DEPTH)',
    });

    // Verify add child button does NOT exist at depth 3
    // The UI should not show "添加子任务" button for depth-3 items
    const addChildButton = depth3Row.getByTestId(/todo-add-child-/);
    await expect(addChildButton).not.toBeVisible();
  });

  test('should list todos with correct hierarchy', async ({ page }) => {
    // Create a parent with child via UI
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Hierarchy Parent');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Hierarchy Parent');

    // Add child
    const parentRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Hierarchy Parent' });
    await parentRow.getByTestId(/todo-add-child-/).click();
    await page.getByTestId('todo-content-input').fill('E2E Hierarchy Child');
    await page.getByTestId('todo-submit-btn').click();

    // Verify hierarchy structure
    await expect(todoTree).toContainText('E2E Hierarchy Parent');
    await expect(todoTree).toContainText('E2E Hierarchy Child');

    // Verify child is nested under parent (has indentation)
    const childRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Hierarchy Child' });
    const childItem = childRow.locator('.todo-item');
    // Child should have marginLeft > 0 (indented)
    const childStyle = await childItem.evaluate((el) => el.style.marginLeft);
    expect(parseInt(childStyle || '0', 10)).toBeGreaterThan(0);
  });

  test('should toggle todo status and verify active context visibility', async ({ page }) => {
    // Create a todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Status Test Todo');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Status Test Todo');

    // Find the todo row
    const todoRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Status Test Todo' });

    // Initial status should be "待处理" (pending)
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('待处理');

    // Toggle status to in_progress
    const statusBtn = todoRow.getByTestId(/todo-status-toggle-/);
    await statusBtn.click();

    // Status should now be "进行中" (in_progress)
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('进行中');

    // When in_progress, "完成" button should appear
    const completeBtn = todoRow.getByTestId(/todo-complete-btn-/);
    await expect(completeBtn).toBeVisible();

    // Click complete
    await completeBtn.click();

    // Status should now be "已完成" (completed)
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('已完成');

    // When completed, "完成" button should NOT appear
    await expect(todoRow.getByTestId(/todo-complete-btn-/)).not.toBeVisible();
  });

  test('should complete todo and verify context removal (no complete button)', async ({ page }) => {
    // Create a todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Completion Test');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Completion Test');

    const todoRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Completion Test' });

    // Toggle to in_progress first
    await todoRow.getByTestId(/todo-status-toggle-/).click();
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('进行中');

    // Complete the todo
    await todoRow.getByTestId(/todo-complete-btn-/).click();

    // Verify status is completed
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('已完成');

    // Context removal behavior: completed todos should NOT have "完成" button
    await expect(todoRow.getByTestId(/todo-complete-btn-/)).not.toBeVisible();

    // Toggle status back - should go to pending
    await todoRow.getByTestId(/todo-status-toggle-/).click();
    await expect(todoRow.getByTestId(/todo-status-/)).toContainText('待处理');
  });

  test('should update todo priority', async ({ page }) => {
    // Create a todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Priority Test');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Priority Test');

    const todoRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Priority Test' });

    // Initial priority should be "中" (medium - default)
    await expect(todoRow.getByTestId(/todo-priority-/)).toContainText('中');

    // Click priority change button
    await todoRow.getByTestId(/todo-priority-select-/).click();

    // Select high priority
    const priorityDropdown = todoRow.locator('.priority-dropdown');
    await priorityDropdown.getByText('高').click();

    // Verify priority changed to high
    await expect(todoRow.getByTestId(/todo-priority-/)).toContainText('高');
  });

  test('should delete todo and verify removal from list', async ({ page }) => {
    // Create a todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Delete Test Todo');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Delete Test Todo');

    const todoRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Delete Test Todo' });

    // Click delete button
    await todoRow.getByTestId(/todo-delete-btn-/).click();

    // Confirm deletion
    const confirmBtn = page.getByTestId('confirm-delete-btn');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Verify todo is removed from tree
    await expect(todoTree).not.toContainText('E2E Delete Test Todo');
  });

  test('should cascade delete parent with children', async ({ page }) => {
    // Create parent with child
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Cascade Parent');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Cascade Parent');

    // Add child
    const parentRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Cascade Parent' });
    await parentRow.getByTestId(/todo-add-child-/).click();
    await page.getByTestId('todo-content-input').fill('E2E Cascade Child');
    await page.getByTestId('todo-submit-btn').click();

    // Verify both appear
    await expect(todoTree).toContainText('E2E Cascade Parent');
    await expect(todoTree).toContainText('E2E Cascade Child');

    // Delete parent
    await parentRow.getByTestId(/todo-delete-btn-/).click();
    await page.getByTestId('confirm-delete-btn').click();

    // Both parent and child should be removed (cascade delete)
    await expect(todoTree).not.toContainText('E2E Cascade Parent');
    await expect(todoTree).not.toContainText('E2E Cascade Child');
  });

  test('should edit todo content', async ({ page }) => {
    // Create a todo
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Original Content');
    await page.getByTestId('todo-submit-btn').click();

    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Original Content');

    const todoRow = todoTree.locator('.todo-row').filter({ hasText: 'E2E Original Content' });

    // Click edit button
    await todoRow.getByTestId(/todo-edit-btn-/).click();

    // Edit form should appear
    const editForm = todoRow.getByTestId(/todo-edit-form-/);
    await expect(editForm).toBeVisible();

    // Clear and type new content
    const editInput = editForm.getByTestId(/todo-edit-content-input-/);
    await editInput.clear();
    await editInput.fill('E2E Updated Content');

    // Save
    await editForm.getByTestId(/todo-save-btn-/).click();

    // Verify content updated
    await expect(todoTree).toContainText('E2E Updated Content');
    await expect(todoTree).not.toContainText('E2E Original Content');
  });

  test('should show empty state when no todos exist', async ({ page }) => {
    // Ensure todos panel is visible
    await expect(page.getByTestId('todos-panel')).toBeVisible();

    // Check if empty state is shown or todo tree is shown
    const todoTree = page.getByTestId('todo-tree');
    const emptyState = page.getByTestId('todos-panel').locator('.empty-state');

    // Either empty state or todo tree should be visible
    const hasEmptyState = await emptyState.isVisible().catch(() => false);
    const hasTodos = await todoTree.isVisible().catch(() => false);

    // If todos exist, delete them all first
    if (hasTodos && !hasEmptyState) {
      // Get all delete buttons and delete each todo
      const deleteButtons = await todoTree.getByTestId(/todo-delete-btn-/).all();
      for (const btn of deleteButtons) {
        await btn.click();
        await page.getByTestId('confirm-delete-btn').click();
        await page.waitForTimeout(100);
      }
      await page.reload();
      await page.getByTestId('tab-todos').click();
    }

    // Now verify empty state
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('暂无待办事项');
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Create a todo first
    await page.getByTestId('todo-create-btn').click();
    await page.getByTestId('todo-content-input').fill('E2E Error Test Todo');
    await page.getByTestId('todo-submit-btn').click();

    // Verify todo appears
    const todoTree = page.getByTestId('todo-tree');
    await expect(todoTree).toContainText('E2E Error Test Todo');

    // Try to create with empty content (should show error or prevent submission)
    await page.getByTestId('todo-create-btn').click();
    const contentInput = page.getByTestId('todo-content-input');
    await contentInput.clear(); // Empty content

    // Submit button should not work with empty content
    await page.getByTestId('todo-submit-btn').click();

    // Form should still be visible (submission failed)
    // Or error should be displayed
    // This test verifies the UI handles validation properly
    await expect(page.getByTestId('todo-create-form')).toBeVisible();
  });

  test('should navigate from todos to session console', async ({ page }) => {
    // Ensure todos panel is visible
    await expect(page.getByTestId('todos-panel')).toBeVisible();

    // Click the "打开会话控制台" button
    await page.getByTestId('todos-open-session').click();

    // Should navigate to session console tab - verify by checking for session elements
    await expect(page.getByTestId('session-new-button')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('session-empty-state')).toBeVisible({ timeout: 5000 });
  });
});