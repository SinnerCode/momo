import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Locator, Page } from 'playwright-core';
import { openFollowManage } from './design-fixture.ts';
import { launch, settle, visit, VIEWPORTS } from './harness.ts';

async function motion(page: Page, trigger: Locator) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const body = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
    await page.waitForFunction(node => (node as HTMLElement).classList.contains('ui-fcollapse-settled'),
      await body.elementHandle());
  }
  const result = await trigger.evaluate(async button => {
    const body = document.getElementById(button.getAttribute('aria-controls')!)!;
    const arrow = button.querySelector(':scope > svg')!;
    const initialStyle = getComputedStyle(arrow);
    const initialTransform = [initialStyle.transform, initialStyle.rotate];
    const height = body.getBoundingClientRect().height;
    (button as HTMLElement).click();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const transition = body.getAnimations().find(animation =>
      animation instanceof CSSTransition && animation.transitionProperty === 'height');
    if (transition) {
      transition.pause();
      transition.currentTime = Number(transition.effect!.getComputedTiming().duration) / 2;
    }
    const middle = body.getBoundingClientRect().height;
    const inert = body.inert;
    const stableArrow = button.querySelector(':scope > svg') === arrow;
    const duration = getComputedStyle(arrow).transitionDuration;
    for (const animation of [...body.getAnimations(), ...arrow.getAnimations()]) animation.finish();
    const finalStyle = getComputedStyle(arrow);
    return { height, middle, inert, transitioned: Boolean(transition), stableArrow,
      duration, transform: [finalStyle.transform, finalStyle.rotate], initialTransform };
  });
  assert.ok(result.height > 0 && result.middle > 0 && result.middle < result.height, JSON.stringify(result));
  assert.equal(result.transitioned, true);
  assert.equal(result.inert, true);
  await page.waitForFunction(node => (node as HTMLElement).hidden || node!.closest('details')?.open === false,
    await body.elementHandle());
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await body.isVisible(), false);
  assert.equal(result.stableArrow, true);
  assert.notEqual(result.duration, '0s');
  assert.notDeepEqual(result.transform, result.initialTransform);
  await trigger.click();
  await page.waitForTimeout(40);
  await trigger.click();
  await page.waitForTimeout(40);
  await trigger.click();
  await page.waitForFunction(node => (node as HTMLElement).classList.contains('ui-fcollapse-settled'),
    await body.elementHandle());
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await body.isVisible(), true);
  assert.equal(await body.evaluate(node => (node as HTMLElement).inert || (node as HTMLElement).hidden), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await trigger.locator(':scope > svg').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
}

describe('折叠正文与箭头共用动画', () => {
  let browser: Browser;
  before(async () => { browser = await launch() });
  after(async () => { await browser.close() });
  for (const viewport of VIEWPORTS) {
    it(`${viewport.name}：关注卡片高度过渡、反向点击，勾选框在行首、站标贴着名称`, async () => {
      const opened = await openFollowManage(browser, viewport);
      try {
        const section = opened.page.getByRole('region', { name: 'kou 的关注来源', exact: true });
        const leading = section.locator('[data-follow-source-row]').first();
        const boxes = await leading.evaluate(node => {
          const icon = node.querySelector('[data-follow-source-site] img')!.getBoundingClientRect();
          const checkbox = node.querySelector('input')!.parentElement!.getBoundingClientRect();
          const line = node.querySelector('a')!.getClientRects()[0]!;
          return { checkbox: checkbox.left, icon: icon.left, iconRight: icon.right, name: line.left,
            middle: Math.abs(icon.top + icon.height / 2 - line.top - line.height / 2) };
        });
        assert.ok(boxes.checkbox < boxes.icon && boxes.iconRight < boxes.name && boxes.middle <= 1, JSON.stringify(boxes));
        await motion(opened.page, section.locator('button[aria-controls]'));
        assert.deepEqual(opened.problems, []);
      } finally { await opened.close() }
    });
    it(`${viewport.name}：任务通知与教程可动画折叠`, async () => {
      const opened = await visit(browser, '/', viewport, async page => {
        await page.route('**/api/library-processing', route => route.fulfill({ json: {
          status: 'running', job_id: 'motion', total: 100, checked: 12, speed_mode: 'standard',
          steps: [{ id: 'sources', label: '扫描文件', status: 'current' }],
        } }));
      });
      try {
        await opened.page.locator('#toasts [data-processing-dock]').waitFor();
        // 此任务由夹具保持运行，补全入口的忙态不会在本用例中结束。
        const taskButtons = '[data-library-completion] [data-split-button] > button[aria-busy="true"]';
        await settle(opened.page, 'body', { except: taskButtons });
        await motion(opened.page, opened.page.locator('#toasts [data-processing-dock] button[aria-controls]'));
        await opened.page.locator('#tutorialBtn').click();
        await opened.page.locator('label').filter({ has: opened.page.getByRole('radio', { name: '界面导览', exact: true }) }).click();
        await motion(opened.page, opened.page.locator('[data-guide-topic="browse"] > details > summary'));
        assert.deepEqual(opened.problems, []);
      } finally { await opened.close() }
    });
  }
});
